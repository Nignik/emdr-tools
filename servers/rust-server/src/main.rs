mod connection_handler;

use connection_handler::ConnectionHandler;
use std::sync::Arc;
use tokio::net::TcpListener;

pub mod comm
{
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}

#[tokio::main]
async fn main()
{
  let args: Vec<String> = std::env::args().collect();
  let (host, port) = match args.len()
  {
    1 => ("127.0.0.1".to_string(), 4000),
    2 => ("127.0.0.1".to_string(), args[1].parse().unwrap_or(4000)),
    3 => (args[1].clone(), args[2].parse().unwrap_or(4000)),
    _ =>
    {
      println!("Usage: {} [host] [port]", args[0]);
      return;
    }
  };

  let addr = format!("{}:{}", host, port);
  let listener = TcpListener::bind(&addr).await.expect("Failed to bind");
  println!("WebSocket server with Protobuf listening on: {}", addr);

  let conn_handler = Arc::new(ConnectionHandler::default());

  while let Ok((stream, _)) = listener.accept().await
  {
    let handler = conn_handler.clone();

    tokio::spawn(async move {
      let conn_id = match handler.accept_connection(stream).await
      {
        Ok(id) => id,
        Err(e) =>
        {
          println!("Failed with {} to accept connection with", e);
          return;
        }
      };
      handler.handle_connection(conn_id).await;
    });
  }
}
