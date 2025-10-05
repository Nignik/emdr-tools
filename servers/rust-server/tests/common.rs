use futures_util::{SinkExt, StreamExt};
use prost::Message;
use rust_server::ConnectionHandler;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::{self};

use anyhow::{Result, anyhow};
use futures_util::Sink;
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message as WsMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

#[derive(Default)]
pub struct Responses {
  pub create_session_resps: Vec<comm::CreateSessionResponse>,
  pub join_session_resps: Vec<comm::JoinSessionResponse>,
  pub params_resps: Vec<comm::Params>,
}

async fn spawn_test_server() -> (Arc<ConnectionHandler>, String) {
  let host = "127.0.0.1";
  let listener = TcpListener::bind((host, 0)).await.expect("Failed to bind");
  let addr = listener.local_addr().expect("Failed to get local address");

  println!("WebSocket server with Protobuf listening on: {}", addr);

  let conn_handler = Arc::new(ConnectionHandler::default());
  let conn_handler_clone = conn_handler.clone();
  tokio::spawn(async move {
    while let Ok((stream, _)) = listener.accept().await {
      let handler = conn_handler_clone.clone();
      tokio::spawn(async move {
        let conn_id = match handler.accept_connection(stream).await {
          Ok(id) => id,
          Err(e) => {
            println!("Failed with {} to accept connection with", e);
            return;
          }
        };
        handler.handle_connection(&conn_id).await.unwrap_or_else(|e| log::error!("{}", e));
        handler.close_connection(&conn_id).await.unwrap_or_else(|e| log::error!("{}", e));
      });
    }
  });

  tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

  (conn_handler.clone(), addr.to_string())
}

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub async fn spawn() -> Result<String> {
  let (_, addr) = spawn_test_server().await;
  Ok(format!("ws://{addr}"))
}

pub async fn connect(url: &str) -> Result<Ws> {
  let (ws, _) = connect_async(url).await?;
  Ok(ws)
}

pub async fn send_proto<S>(ws: &mut S, msg: WebSocketMessage) -> Result<()>
where
  S: Sink<WsMessage> + Unpin,
  S::Error: std::error::Error + Send + Sync + 'static,
{
  let mut buf = Vec::new();
  msg.encode(&mut buf)?;
  ws.send(WsMessage::Binary(buf.into())).await?;
  Ok(())
}

pub async fn recv_proto<S>(ws: &mut S, timeout: Duration) -> Result<WebSocketMessage>
where
  S: futures_util::Stream<Item = Result<WsMessage, tungstenite::Error>> + Unpin,
{
  let msg: WsMessage = tokio::time::timeout(timeout, ws.next()).await.map_err(|_| anyhow!("timed out after {:?}", timeout))?.ok_or_else(|| anyhow!("websocket stream ended"))??;

  let bytes = match &msg {
    WsMessage::Binary(_) | WsMessage::Text(_) => msg.into_data(),
    WsMessage::Close(frame) => {
      let reason = frame.as_ref().map(|f| f.reason.to_string()).unwrap_or_default();
      return Err(anyhow!("websocket closed by peer: {}", reason));
    }
    other => return Err(anyhow!("unexpected WS frame: {other:?}")),
  };

  Ok(WebSocketMessage::decode(&bytes[..])?)
}

pub async fn recv_protos<S>(ws: &mut S, timeout: Duration, count: usize) -> Result<Vec<WebSocketMessage>>
where
  S: futures_util::Stream<Item = Result<WsMessage, tungstenite::Error>> + Unpin,
{
  let mut messages = Vec::new();
  let deadline = tokio::time::Instant::now() + timeout;

  for _ in 0..count {
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    if remaining.is_zero() {
      break;
    }

    let msg: WsMessage = match tokio::time::timeout(remaining, ws.next()).await {
      Ok(Some(Ok(msg))) => msg,
      Ok(Some(Err(e))) => return Err(anyhow!("websocket error: {}", e)),
      Ok(None) => return Err(anyhow!("websocket stream ended")),
      Err(_) => break,
    };

    let bytes = match &msg {
      WsMessage::Binary(_) | WsMessage::Text(_) => msg.into_data(),
      WsMessage::Ping(_) => prost::bytes::Bytes::new(),
      WsMessage::Close(frame) => {
        let reason = frame.as_ref().map(|f| f.reason.to_string()).unwrap_or_default();
        return Err(anyhow!("websocket closed by peer: {}", reason));
      }
      other => return Err(anyhow!("unexpected WS frame: {other:?}")),
    };

    if !bytes.is_empty() {
      messages.push(WebSocketMessage::decode(&bytes[..])?);
    }
  }

  Ok(messages)
}

pub async fn transform_protos(msgs: &Vec<WebSocketMessage>) -> Responses {
  let mut resps = Responses::default();
  for msg in msgs.iter() {
    match &msg.message {
      Some(ProtoMessage::CreateSessionResponse(r)) => resps.create_session_resps.push(r.clone()),
      Some(ProtoMessage::JoinSessionResponse(r)) => resps.join_session_resps.push(r.clone()),
      Some(ProtoMessage::Params(r)) => resps.params_resps.push(r.clone()),
      other => log::warn!("Received unexpected response message type: {other:?}")
    }
  }

  resps
}

pub async fn create_session(ws: &mut Ws) -> Result<Responses> {
  let req = WebSocketMessage {
    message: Some(ProtoMessage::CreateSessionRequest(comm::CreateSessionRequest {})),
  };
  send_proto(ws, req).await?;

  let msgs = recv_protos(ws, Duration::from_secs(1), 1).await?;
  Ok(transform_protos(&msgs).await)
}

pub async fn join_session(ws: &mut Ws, sid: String) -> Result<Responses> {
  let req = WebSocketMessage {
    message: Some(ProtoMessage::JoinSessionRequest(comm::JoinSessionRequest { sid })),
  };
  send_proto(ws, req).await?;

  let msgs = recv_protos(ws, Duration::from_secs(1), 3).await?;
  Ok(transform_protos(&msgs).await)
}

pub async fn send_params(sender_ws: &mut Ws, receiver_ws: &mut Ws, params: comm::Params) -> Result<Responses> {
  let req = WebSocketMessage { message: Some(ProtoMessage::Params(params)) };
  send_proto(sender_ws, req).await?;

  let msgs = recv_protos(receiver_ws, Duration::from_secs(1), 1).await?;
  Ok(transform_protos(&msgs).await)
}
