use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio::net::{TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message as WsMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

type WsSenderType = futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, WsMessage>;
type WsReceiverType = futures_util::stream::SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>;

#[derive(Default)]
pub struct ConnectionHandler {
  conns: std::collections::HashMap<u32, (WsSenderType, WsReceiverType)>,
  current_conn_id: u32,
}

impl ConnectionHandler {
  pub async fn accept_connection(&mut self, stream: TcpStream) -> Result<u32, Box<dyn std::error::Error>> {
    let ws_stream = match accept_async(stream).await {
      Ok(ws) => ws,
      Err(e) => {
          println!("WebSocket handshake failed: {}", e);
          return Err(Box::new(e));
      }
    };

    let conn_id = self.current_conn_id.clone();
    self.conns.insert(conn_id.clone(), ws_stream.split());
    self.current_conn_id += 1;

    let user_id = format!("user_{}", conn_id);
    let welcome = WebSocketMessage { message: Some(ProtoMessage::WelcomeResponse(comm::WelcomeResponse { user_id: user_id.clone(), server_info: Some(comm::ServerInfo { version: "1.0.0".to_string() }) })) };
    self.send_message(conn_id.clone(), welcome).await;

    self.current_conn_id += 1;
    Ok(conn_id)
  }

  pub async fn handle_connection(&mut self, conn_id: u32) {
    while let Some(msg) = self.get_receiver(conn_id).next().await {
      match msg {
        Ok(WsMessage::Binary(bytes)) => match WebSocketMessage::decode(&bytes[..]) {
          Ok(decoded_msg) => {
            self.handle_message(conn_id, decoded_msg).await;
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

  fn get_sender(&mut self, conn_id: u32) -> &mut WsSenderType {
    &mut self.conns.get_mut(&conn_id).expect("Tried to get invalid sender").0
  }

  fn get_receiver(&mut self, conn_id: u32) -> &mut WsReceiverType {
    &mut self.conns.get_mut(&conn_id).expect("Tried to get invalid receiver").1
  }

  async fn send_message(&mut self, sender_id: u32, msg: WebSocketMessage) {
    let mut buf = Vec::new();
    let sender = self.get_sender(sender_id);
    if msg.encode(&mut buf).is_ok() {
      let _ = sender.send(WsMessage::Binary(buf.into())).await;
    }
  }

  async fn handle_message(&self, _sender_id: u32, _msg: WebSocketMessage) {
    /*
    match msg {
      JoinRequest(username)
    }*/
  }
}
