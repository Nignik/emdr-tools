mod connection_handler;

use tokio::net::{TcpListener};
use std::sync::Arc;
use tokio::sync::Mutex;
use connection_handler::ConnectionHandler;


pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}

#[tokio::main]
async fn main() {
  let addr = "127.0.0.1:7878";
  let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
  println!("WebSocket server with Protobuf listening on: {}", addr);

  let conn_handler = Arc::new(Mutex::new(ConnectionHandler::default()));
  while let Ok((stream, addr)) = listener.accept().await {
    let handler = conn_handler.clone(); // Clone the Arc, not the handler

    let conn_id = match handler.lock().await.accept_connection(stream).await {
      Ok(id) => id,
      Err(e) => {
        println!("Failed with {} to accept connection with: {}", e, addr);
        continue;
      }
    };

    let handler = conn_handler.clone();
    tokio::spawn(async move {
      handler.lock().await.handle_connection(conn_id).await;
    });
  }
}
