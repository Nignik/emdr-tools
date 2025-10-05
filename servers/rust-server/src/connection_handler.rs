use anyhow::{Result, anyhow};
use futures_util::{
  SinkExt, StreamExt,
  stream::{SplitSink, SplitStream},
};
use prost::Message;
use std::{collections::HashMap, sync::Arc};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_tungstenite::{WebSocketStream, accept_async, tungstenite::Message as TokioMessage};
use tokio::time::{interval, MissedTickBehavior, Duration};
use uuid::Uuid;

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

type WsSenderType = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, TokioMessage>>>;
type WsReceiverType = Arc<Mutex<SplitStream<tokio_tungstenite::WebSocketStream<TcpStream>>>>;

pub struct Session {
  client_ids: Vec<u32>,
  params_msg: WebSocketMessage,
}

impl Session {
  pub fn new() -> Self {
    Self {
      client_ids: Vec::new(),
      params_msg: WebSocketMessage::default(),
    }
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
    let sender = Arc::new(Mutex::new(sender));
    let receiver = Arc::new(Mutex::new(receiver));
    
    self.conns.lock().await.insert(conn_id.clone(), (sender.clone(), receiver));
    *self.current_conn_id.lock().await += 1;

    let hb_sender = sender.clone();
    let hb_conn_id = conn_id.clone();
    tokio::spawn(async move {
      let mut tick = interval(Duration::from_secs(25));
      tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

      loop {
        tick.tick().await;
        match hb_sender.lock().await.send(TokioMessage::Ping(prost::bytes::Bytes::new())).await {
          Ok(_) => {
            log::trace!("Sent heartbeat ping to {}", hb_conn_id);
          }
          Err(e) => {
            log::debug!("Heartbeat stopped for {}: {}", hb_conn_id, e);
            break;
          }
        }
      }
    });

    log::info!("WebSocket connected with: {}", &conn_id);
    Ok(conn_id)
  }

  pub async fn close_connection(&self, conn_id: &u32) -> Result<()> {
    self.conns.lock().await.remove(&conn_id).ok_or_else(|| anyhow!("Failed to remove connection: {}", conn_id))?;
    let mut sessions = self.sessions.lock().await;
    let mut session_to_remove = None;

    for (session_id, session) in sessions.iter_mut() {
      if let Some(pos) = session.client_ids.iter().position(|&id| id == *conn_id) {
        session.client_ids.remove(pos);

        if session.client_ids.is_empty() {
          session_to_remove = Some(session_id.clone());
        }
        break;
      }
    }

    if let Some(session_id) = session_to_remove {
      sessions.remove(&session_id);
    }

    Ok(())
  }

  pub async fn handle_connection(&self, conn_id: &u32) -> Result<()> {
    let receiver = self.get_receiver(conn_id).await.ok_or_else(|| anyhow!("Failed to find receiver: {}", conn_id))?;
    while let Some(msg) = receiver.lock().await.next().await {
      log::info!("Received message");
      match msg {
        Ok(TokioMessage::Binary(bytes)) => match WebSocketMessage::decode(&bytes[..]) {
          Ok(decoded_msg) => self.handle_message(&conn_id, decoded_msg).await,
          Err(e) => log::error!("Failed to decode message: {}", e),
        },
        Err(e) => log::error!("Failed to receive message: {}", e),
        _ => log::warn!("Unhandled message format received"),
      }
    }

    Ok(())
  }

  async fn get_sender(&self, conn_id: &u32) -> Option<WsSenderType> {
    self.conns.lock().await.get(&conn_id).map(|(sender, _)| sender.clone())
  }

  async fn get_receiver(&self, conn_id: &u32) -> Option<WsReceiverType> {
    self.conns.lock().await.get(&conn_id).map(|(_, receiver)| receiver.clone())
  }

  async fn send_message(&self, sender_id: &u32, msg: &WebSocketMessage) -> Result<()> {
    let mut buf = Vec::new();
    let sender = self.get_sender(sender_id).await.ok_or_else(|| anyhow!("Tried to send message with sender: {}, but it doesn't exist", sender_id))?;

    if msg.encode(&mut buf).is_ok() {
      sender.lock().await.send(TokioMessage::Binary(buf.into())).await?
    }

    Ok(())
  }

  async fn message_session(&self, session_id: &str, msg: &WebSocketMessage) -> Result<(), String> {
    let ids: Vec<u32> = {
      let sessions = self.sessions.lock().await;
      match sessions.get(session_id) {
        Some(session) => session.client_ids.clone(),
        None => Err(format!("Tried to message session: {}, but it doesn't exist", session_id))?,
      }
    };

    for id in ids {
      self.send_message(&id, &msg).await.unwrap_or_else(|e| log::error!("{}", e));
    }

    Ok(())
  }

  async fn create_session(&self) -> String {
    let session_id = Uuid::new_v4();
    self.sessions.lock().await.insert(session_id.to_string(), Session::new());

    session_id.to_string()
  }

  async fn join_session(&self, client_id: &u32, session_id: &str) -> Result<(), String> {
    let mut sessions = self.sessions.lock().await;
    let session = sessions.get_mut(session_id).ok_or_else(|| format!("Tried to join session: {}, but it doesn't exist", session_id).to_string())?;
    session.client_ids.push(client_id.clone());

    Ok(())
  }

  async fn handle_message(&self, conn_id: &u32, msg: WebSocketMessage) {
    let cloned_msg = msg.clone();
    match msg.message {
      Some(ProtoMessage::Params(params)) => self.handle_params(&params, &cloned_msg).await,
      Some(ProtoMessage::CreateSessionRequest(_)) => self.handle_create_session_request(conn_id).await,
      Some(ProtoMessage::JoinSessionRequest(join_request)) => self.handle_join_session_request(&join_request, &conn_id).await,
      _ => log::warn!("Received message of unknown type"),
    }
  }

  async fn handle_params(&self, params: &comm::Params, params_msg: &WebSocketMessage) {
    log::info!("Sending params to session: {}", params.sid);

    if let Some(session) = self.sessions.lock().await.get_mut(&params.sid) {
      session.params_msg = params_msg.clone();
    }

    self.message_session(&params.sid, params_msg).await.unwrap_or_else(|e| log::error!("{}", e));
  }

  async fn handle_create_session_request(&self, conn_id: &u32) {
    log::info!("Creating session");
    let session_id = self.create_session().await;
    let session_url = format!("https://test-f0m.pages.dev/client?sid={}", session_id);
    let response_msg = WebSocketMessage {
      message: Some(ProtoMessage::CreateSessionResponse(comm::CreateSessionResponse { accepted: true, session_url })),
    };
    self.send_message(&conn_id, &response_msg).await.unwrap_or_else(|e| log::error!("{}", e));
    self.join_session(&conn_id, &session_id).await.unwrap_or_else(|e| log::error!("{}", e));
  }

  async fn handle_join_session_request(&self, join_request: &comm::JoinSessionRequest, conn_id: &u32) {
    let session_id = &join_request.sid;
    log::info!("Client joining session {}", session_id);
    let accepted = self.join_session(&conn_id, &session_id).await.inspect_err(|e| log::error!("{}", e)).is_ok();
    let response_msg = WebSocketMessage {
      message: Some(ProtoMessage::JoinSessionResponse(comm::JoinSessionResponse { accepted })),
    };
    self.message_session(&session_id, &response_msg).await.unwrap_or_else(|e| log::error!("{}", e));

    if !accepted {
      return;
    }

    if let Some(session) = self.sessions.lock().await.get(session_id) {
      if session.params_msg.message != None {
        self.send_message(&conn_id, &session.params_msg).await.unwrap_or_else(|e| log::error!("{}", e));
      }
    }
  }
}
