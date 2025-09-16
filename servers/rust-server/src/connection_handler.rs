use futures_util::stream::SplitSink;
use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::{accept_async, tungstenite::Message as TokioMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

type WsSenderType = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, TokioMessage>>>;
type WsReceiverType = Arc<Mutex<SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>>>;

#[derive(Default)]
pub struct ConnectionHandler {
  conns: Arc<Mutex<HashMap<u32, (WsSenderType, WsReceiverType)>>>,
  current_conn_id: Mutex<u32>,
}

impl ConnectionHandler {
  pub async fn accept_connection(&self, stream: TcpStream) -> Result<u32, Box<dyn std::error::Error>> {
    let ws_stream = match accept_async(stream).await {
      Ok(ws) => ws,
      Err(e) => {
        println!("WebSocket handshake failed: {}", e);
        return Err(Box::new(e));
      }
    };

    let conn_id = self.current_conn_id.lock().await.clone();
    let (sender, receiver) = ws_stream.split();
    self.conns.lock().await.insert(conn_id.clone(), (Arc::new(Mutex::new(sender)), Arc::new(Mutex::new(receiver))));
    *self.current_conn_id.lock().await += 1;

    let user_id = format!("user_{}", conn_id);

    println!("WebSocket connected, user: {}", user_id);
    Ok(conn_id)
  }

  pub async fn handle_connection(&self, conn_id: u32) {
    println!("Handling connection");
    if let Some(receiver) = self.get_receiver(conn_id).await {
      while let Some(msg) = receiver.lock().await.next().await {
        println!("Received message");
        match msg {
          Ok(TokioMessage::Binary(bytes)) => match WebSocketMessage::decode(&bytes[..]) {
            Ok(decoded_msg) => {
              self.handle_message(decoded_msg).await;
            }
            Err(e) => {
              println!("Failed to decode message: {}", e);
            }
          },
          Err(e) => {
            println!("Failed to receive message: {}", e);
          }
          _ => {
            println!("Unhandled message format received");
          }
        }
      }
    }
  }

  async fn get_sender(&self, conn_id: u32) -> Option<WsSenderType> {
    self.conns.lock().await.get(&conn_id).map(|(sender, _)| sender.clone())
  }

  async fn get_receiver(&self, conn_id: u32) -> Option<WsReceiverType> {
    self.conns.lock().await.get(&conn_id).map(|(_, receiver)| receiver.clone())
  }

  async fn send_message(&self, sender_id: u32, msg: WebSocketMessage) {
    let mut buf = Vec::new();
    if let Some(sender) = self.get_sender(sender_id).await {
      if msg.encode(&mut buf).is_ok() {
        let _ = sender.lock().await.send(TokioMessage::Binary(buf.into())).await;
      }
    }
  }

  async fn message_all(&self, msg: WebSocketMessage) {
    let ids: Vec<u32> = {
      let conns = self.conns.lock().await;
      conns.keys().cloned().collect()
    };

    for id in ids {
      self.send_message(id, msg.clone()).await;
    }
  }

  async fn handle_message(&self, msg: WebSocketMessage) {
    let cloned_msg = msg.clone();
    match msg.message {
      Some(ProtoMessage::Params(_)) => {
        println!("Sending message to all");
        self.message_all(cloned_msg.clone()).await;
      }
      _ => {}
    }
  }
}