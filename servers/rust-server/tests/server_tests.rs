mod common;

use anyhow::{Result};

pub mod comm {
  include!(concat!(env!("OUT_DIR"), "/emdr_messages.rs"));
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn server_creates_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;

    let resp = common::create_session(&mut host).await?;
    assert!(resp.accepted);
    assert_eq!(resp.session_url, "0");

    host.close(None).await.ok();
    Ok(())
  }

  #[tokio::test]
  async fn server_lets_join_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let sid = common::create_session(&mut host).await?.session_url;
    let resp = common::join_session(&mut client, sid).await?;
    assert!(resp.accepted);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }
}
