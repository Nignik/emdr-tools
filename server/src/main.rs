use futures_util::{SinkExt, StreamExt};
use prost::Message;
use std::net::SocketAddr;
use std::time::SystemTime;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message as WsMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}

use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

#[tokio::main]
async fn main() {
  let addr = "127.0.0.1:7878";
  let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
  println!("WebSocket server with Protobuf listening on: {}", addr);

  while let Ok((stream, addr)) = listener.accept().await {
    tokio::spawn(handle_connection(stream, addr));
  }
}

async fn handle_connection(mut stream: TcpStream, addr: SocketAddr) {
  println!("New connection from: {}", addr);

  let ws_stream = match accept_async(stream).await {
    Ok(ws) => ws,
    Err(e) => {
      println!("WebSocket handshake failed: {}", e);
      return;
    }
  };

  let (mut ws_sender, mut ws_receiver) = ws_stream.split();
  let user_id = format!("user_{}", addr.port());
  let welcome = WebSocketMessage {
    message: Some(ProtoMessage::WelcomeResponse(comm::WelcomeResponse {
      user_id: user_id.clone(),
      server_info: Some(comm::ServerInfo { version: "1.0.0".to_string() }),
    })),
  };

  send_proto_message(&mut ws_sender, welcome).await;
}

async fn send_proto_message(
  ws_sender: &mut futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<TcpStream>,
    WsMessage,
  >,
  msg: WebSocketMessage
) {
  let mut buf = Vec::new();
  if msg.encode(&mut buf).is_ok() {
    let _ = ws_sender.send(WsMessage::Binary(buf.into())).await;
  }
}