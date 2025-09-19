use futures_util::{
  SinkExt, StreamExt,
  stream::{SplitSink, SplitStream},
};
use prost::Message;
use std::{collections::HashMap, sync::Arc};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_tungstenite::{WebSocketStream, accept_async, tungstenite::Message as TokioMessage};
use uuid::Uuid;
use anyhow::{Result, anyhow};

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
}

impl ConnectionHandler {
  pub async fn accept_connection(&self, stream: TcpStream) -> Result<u32> {
    let ws_stream = accept_async(stream).await?;
    let conn_id = self.current_conn_id.lock().await.clone();
    let (sender, receiver) = ws_stream.split();
    self.conns.lock().await.insert(conn_id.clone(), (Arc::new(Mutex::new(sender)), Arc::new(Mutex::new(receiver))));
    *self.current_conn_id.lock().await += 1;

    log::info!("WebSocket connected with: {}", &conn_id);
    Ok(conn_id)
  }

  pub async fn handle_connection(&self, conn_id: u32) -> Result<()>{
    let receiver = self.get_receiver(conn_id).await.ok_or_else(|| anyhow!("Failed to find receiver: {}", conn_id))?;
    while let Some(msg) = receiver.lock().await.next().await {
      log::info!("Received message");
      match msg {
        Ok(TokioMessage::Binary(bytes)) => match WebSocketMessage::decode(&bytes[..]) {
          Ok(decoded_msg) => self.handle_message(conn_id.clone(), decoded_msg).await,
          Err(e) => log::error!("Failed to decode message: {}", e),
        },
        Err(e) => log::error!("Failed to receive message: {}", e),
        _ => log::warn!("Unhandled message format received"),
      }
    }

    Ok(())
  }

  async fn get_sender(&self, conn_id: u32) -> Option<WsSenderType> {
    self.conns.lock().await.get(&conn_id).map(|(sender, _)| sender.clone())
  }

  async fn get_receiver(&self, conn_id: u32) -> Option<WsReceiverType> {
    self.conns.lock().await.get(&conn_id).map(|(_, receiver)| receiver.clone())
  }

  async fn send_message(&self, sender_id: u32, msg: WebSocketMessage) -> Result<()> {
    let mut buf = Vec::new();
    let sender = self.get_sender(sender_id).await.ok_or_else(|| anyhow!("Tried to send message with sender: {}, but it doesn't exist", sender_id))?;

    if msg.encode(&mut buf).is_ok() {
      sender.lock().await.send(TokioMessage::Binary(buf.into())).await?
    }

    Ok(())
  }

  async fn message_session(&self, session_id: &str, msg: WebSocketMessage) -> Result<(), String> {
    let ids: Vec<u32> = {
      let sessions = self.sessions.lock().await;
      match sessions.get(session_id) {
        Some(session) => session.client_ids.clone(),
        None => Err(format!("Tried to message session: {}, but it doesn't exist", session_id))?,
      }
    };

    for id in ids {
      self.send_message(id, msg.clone()).await.unwrap_or_else(|e| log::error!("{}", e));
    }

    Ok(())
  }

  async fn create_session(&self, host_id: u32) -> String {
    let session_id = Uuid::new_v4();
    self.sessions.lock().await.insert(session_id.to_string(), Session::new(host_id.clone()));

    session_id.to_string()
  }

  async fn join_session(&self, client_id: u32, session_id: &str) -> Result<(), String> {
    let mut sessions = self.sessions.lock().await;
    let session = sessions.get_mut(session_id).ok_or_else(|| format!("Tried to join session: {}, but it doesn't exist", session_id).to_string())?;
    session.client_ids.push(client_id.clone());

    Ok(())
  }

  async fn handle_message(&self, conn_id: u32, msg: WebSocketMessage) {
    let cloned_msg = msg.clone();
    match msg.message {
      Some(ProtoMessage::Params(params)) => {
        log::info!("Sending params to session: {}", params.sid);
        self.message_session(&params.sid, cloned_msg.clone()).await.unwrap_or_else(|e| log::error!("{}", e));
      }
      Some(ProtoMessage::CreateSessionRequest(_)) => {
        log::info!("Creating session");
        let session_id = self.create_session(conn_id.clone()).await;
        let session_url = format!("http://localhost:5173/client?sid={}", session_id);
        let response_msg = WebSocketMessage {
          message: Some(ProtoMessage::CreateSessionResponse(comm::CreateSessionResponse { accepted: true, session_url: session_url })),
        };
        self.send_message(conn_id.clone(), response_msg).await.unwrap_or_else(|e| log::error!("{}", e));
      }
      Some(ProtoMessage::JoinSessionRequest(join_request)) => {
        let session_id = join_request.sid;
        println!("Client joining session {}", session_id);
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
        self.send_message(conn_id.clone(), response_msg).await.unwrap_or_else(|e| log::error!("{}", e));
      }
      _ => log::warn!("Received message of unknown type")
    }
  }
}
