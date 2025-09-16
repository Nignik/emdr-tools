use rust_server::ConnectionHandler;

use futures_util::{SinkExt, StreamExt};
use prost::Message;
use std::sync::Arc;
use tokio_tungstenite::{tungstenite::Message as TokioMessage};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}
use comm::{WebSocketMessage, web_socket_message::Message as ProtoMessage};

#[cfg(test)]
mod tests {
  use super::*;
  use tokio::net::TcpListener;
  use tokio_tungstenite::connect_async;

  async fn spawn_test_server() -> String {
    let host = "127.0.0.1";
    let listener = TcpListener::bind((host, 0)).await.expect("Failed to bind");
    let addr = listener.local_addr().expect("Failed to get local address");

    println!("WebSocket server with Protobuf listening on: {}", addr);

    let conn_handler = Arc::new(ConnectionHandler::default());
    tokio::spawn(async move {
      while let Ok((stream, _)) = listener.accept().await {
        let handler = conn_handler.clone();

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

    addr.to_string()
  }

  #[tokio::test]
  async fn server_accepts_connections() {
    let addr = spawn_test_server().await;

    let url = format!("ws://{}", addr);
    let (_, _) = connect_async(&url).await.expect("Failed to connect");
    let (_, _) = connect_async(&url).await.expect("Failed to connect");
    let (_, _) = connect_async(&url).await.expect("Failed to connect");
    let (_, _) = connect_async(&url).await.expect("Failed to connect");
  }

  #[tokio::test]
  async fn server_handles_message_params() {
    let addr = spawn_test_server().await;

    let url = format!("ws://{}", addr);
    let (mut rx, _) = connect_async(&url).await.expect("Failed to connect");
    let (mut tx, _) = connect_async(&url).await.expect("Failed to connect");

    let handle = tokio::spawn(async move {
      while let Some(msg) = rx.next().await {
        println!("TEST: Received message");
        let bytes = msg.expect("Failed to read message").into_data();
        let decoded_msg = WebSocketMessage::decode(&bytes[..]).expect("Failed to decode message");
        match decoded_msg.message {
          Some(ProtoMessage::Params(params)) => {
            assert_eq!(params.size, 10);
            assert_eq!(params.speed, 10);
            assert_eq!(params.color, "blue");
            rx.close(None).await.ok();
            return;
          }
          _ => {}
        }
      }
    });

    let msg = WebSocketMessage { message: Some(ProtoMessage::Params(comm::Params { size: 10, speed: 10, color: String::from("blue") })) };

    let mut buf = Vec::new();
    if msg.encode(&mut buf).is_ok() {
      let _ = tx.send(TokioMessage::Binary(buf.into())).await.unwrap();
    }

    tokio::time::timeout(tokio::time::Duration::from_secs(1), handle).await.expect("Test timed out").expect("Receiver task failed");

    tx.close(None).await.ok();
  }
}