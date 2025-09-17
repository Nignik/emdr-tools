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
        handler.handle_connection(conn_id).await;
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

  // Get the payload bytes robustly across tungstenite versions
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

pub async fn create_session(ws: &mut Ws) -> Result<comm::CreateSessionResponse> {
  let req = WebSocketMessage {
    message: Some(ProtoMessage::CreateSessionRequest(comm::CreateSessionRequest {})),
  };
  send_proto(ws, req).await?;
  let msg = recv_proto(ws, Duration::from_secs(1)).await?;
  match msg.message {
    Some(ProtoMessage::CreateSessionResponse(r)) => Ok(r),
    other => Err(anyhow!("Expected CreateSessionResponse, got {other:?}")),
  }
}

pub async fn join_session(ws: &mut Ws, sid: String) -> Result<comm::JoinSessionResponse> {
  let req = WebSocketMessage {
    message: Some(ProtoMessage::JoinSessionRequest(comm::JoinSessionRequest { sid })),
  };
  send_proto(ws, req).await?;
  let msg = recv_proto(ws, Duration::from_secs(1)).await?;
  match msg.message {
    Some(ProtoMessage::JoinSessionResponse(r)) => Ok(r),
    other => Err(anyhow!("Expected JoinSessionResponse, got {other:?}")),
  }
}

pub async fn send_params(sender_ws: &mut Ws, receiver_ws: &mut Ws, params: comm::Params) -> Result<comm::Params> {
  let req = WebSocketMessage {
    message: Some(ProtoMessage::Params(params)),
  };
  send_proto(sender_ws, req).await?;
  let msg = recv_proto(receiver_ws, Duration::from_secs(1)).await?;
  match msg.message {
    Some(ProtoMessage::Params(r)) => Ok(r),
    other => Err(anyhow!("Expected JoinSessionResponse, got {other:?}")),
  }
}
