use futures_util::{
  SinkExt, StreamExt,
  stream::{SplitSink, SplitStream},
};
use prost::Message;
use std::{collections::HashMap, sync::Arc};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_tungstenite::{WebSocketStream, accept_async, tungstenite::Message as TokioMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

type WsSenderType = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, TokioMessage>>>;
type WsReceiverType = Arc<Mutex<SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>>>;

pub struct Session {
  client_ids: Vec<u32>,
  host_id: u32,
}

impl Session {
  pub fn new(host_id: u32) -> Self {
    Self { client_ids: Vec::new(), host_id: host_id }
  }
}

#[derive(Default)]
pub struct ConnectionHandler {
  conns: Arc<Mutex<HashMap<u32, (WsSenderType, WsReceiverType)>>>,
  sessions: Arc<Mutex<HashMap<String, Session>>>,
  current_conn_id: Mutex<u32>,
  current_session_id: Mutex<u32>,
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
              self.handle_message(conn_id.clone(), decoded_msg).await;
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

  async fn message_session(&self, session_id: &str, msg: WebSocketMessage) {
    let ids: Vec<u32> = {
      let sessions = self.sessions.lock().await;
      let session = sessions.get(session_id).unwrap();
      session.client_ids.clone()
    };

    for id in ids {
      self.send_message(id, msg.clone()).await;
    }
  }

  async fn create_session(&self, host_id: u32) -> String {
    let session_id = self.current_session_id.lock().await.clone().to_string();
    self.sessions.lock().await.insert(session_id.clone(), Session::new(host_id.clone()));
    *self.current_session_id.lock().await += 1;
    session_id.to_string()
  }

  async fn join_session(&self, client_id: u32, session_id: &str) -> Result<(), String> {
    let mut sessions = self.sessions.lock().await;
    let session = sessions.get_mut(session_id).ok_or_else(|| "Session not found".to_string())?;
    session.client_ids.push(client_id.clone());
    
    Ok(())
  }

  async fn handle_message(&self, conn_id: u32, msg: WebSocketMessage) {
    let cloned_msg = msg.clone();
    match msg.message {
      Some(ProtoMessage::Params(params)) => {
        println!("Sending params to session: {}", params.sid);
        self.message_session(&params.sid, cloned_msg.clone()).await;
      }
      Some(ProtoMessage::CreateSessionRequest(_)) => {
        println!("Creating session");
        let session_id = self.create_session(conn_id.clone()).await;
        let response_msg = WebSocketMessage {
          message: Some(ProtoMessage::CreateSessionResponse(comm::CreateSessionResponse { accepted: true, sid: session_id })),
        };
        self.send_message(conn_id.clone(), response_msg).await;
      }
      Some(ProtoMessage::JoinSessionRequest(join_request)) => {
        println!("Client joining session");
        let session_id = join_request.sid;
        let accepted;
        match self.join_session(conn_id.clone(), &session_id).await {
          Ok(_) => {
            accepted = true;
          }
          Err(e) => {
            println!("Client failed to join session: {}", e);
            accepted = false;
          } 
        }
        let response_msg = WebSocketMessage {
          message: Some(ProtoMessage::JoinSessionResponse(comm::JoinSessionResponse { accepted: accepted })),
        };
        self.send_message(conn_id.clone(), response_msg).await;
      }
      _ => {}
    }
  }
}
