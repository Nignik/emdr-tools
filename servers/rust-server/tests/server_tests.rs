mod common;

use anyhow::{Result};

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn server_creates_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;

    let resp = common::create_session(&mut host).await?;
    assert!(resp.accepted);

    host.close(None).await.ok();
    Ok(())
  }

  #[tokio::test]
  async fn server_lets_join_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let session_url = common::create_session(&mut host).await?.session_url;
    let (_, sid) = session_url.split_once("?sid=").unwrap();
    let resp = common::join_session(&mut client, sid.to_string()).await?;
    assert!(resp.accepted);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }

  #[tokio::test]
  async fn server_passess_parameters_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let session_url = common::create_session(&mut host).await?.session_url;
    let (_, sid) = session_url.split_once("?sid=").unwrap();
    let _ = common::join_session(&mut client, sid.to_string()).await?;

    let params = common::comm::Params{size: 1, speed: 2, color: String::from("blue"), sid: sid.to_string()};
    let params_response = common::send_params(&mut host, &mut client, params).await?;
    assert_eq!(params_response.size, 1);
    assert_eq!(params_response.speed, 2);
    assert_eq!(params_response.color, "blue");
    assert_eq!(params_response.sid, sid);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }
}
