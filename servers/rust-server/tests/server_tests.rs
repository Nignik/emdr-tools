mod common;

use anyhow::{Result};

#[cfg(test)]
mod tests {
  use super::*;

  #[test_log::test(tokio::test)]
  async fn server_creates_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;

    let resp = common::create_session(&mut host).await?;
    assert_eq!(resp.create_session_resps.len(), 1);
    assert_eq!(resp.join_session_resps.len(), 0);
    assert_eq!(resp.params_resps.len(), 0);

    assert_eq!(resp.create_session_resps[0].accepted, true);

    host.close(None).await.ok();
    Ok(())
  }

  #[test_log::test(tokio::test)]
  async fn server_lets_join_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let session_url = &common::create_session(&mut host).await?.create_session_resps[0].session_url; 
    let (_, sid) = session_url.split_once("?sid=").unwrap();

    let resp = common::join_session(&mut client, sid.to_string()).await?;
    assert_eq!(resp.create_session_resps.len(), 0);
    assert_eq!(resp.join_session_resps.len(), 1);
    assert_eq!(resp.params_resps.len(), 0);

    assert_eq!(resp.join_session_resps[0].accepted, true);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }

  
  #[test_log::test(tokio::test)]
  async fn server_passess_parameters_session() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let session_url = &common::create_session(&mut host).await?.create_session_resps[0].session_url; 
    let (_, sid) = session_url.split_once("?sid=").unwrap();
    let _ = common::join_session(&mut client, sid.to_string()).await?;

    let params = common::comm::Params{size: 1, speed: 2, color: String::from("blue"), sid: sid.to_string()};
    let resp = common::send_params(&mut host, &mut client, params.clone()).await?;

    assert_eq!(resp.create_session_resps.len(), 0);
    assert_eq!(resp.join_session_resps.len(), 0);
    assert_eq!(resp.params_resps.len(), 1);
    assert_eq!(resp.params_resps[0], params);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }

  #[test_log::test(tokio::test)]
  async fn server_passess_parameters_on_join() -> Result<()> {
    let url = common::spawn().await?;
    let mut host = common::connect(&url).await?;
    let mut client = common::connect(&url).await?;

    let session_url = &common::create_session(&mut host).await?.create_session_resps[0].session_url; 
    let (_, sid) = session_url.split_once("?sid=").unwrap();

    let params = common::comm::Params{size: 1, speed: 2, color: String::from("blue"), sid: sid.to_string()};
    let _ = common::send_params(&mut host, &mut client, params.clone()).await?;

    let resp = common::join_session(&mut client, sid.to_string()).await?;
    assert_eq!(resp.create_session_resps.len(), 0);
    assert_eq!(resp.join_session_resps.len(), 1);
    assert_eq!(resp.params_resps.len(), 1);
    assert_eq!(resp.params_resps[0], params);

    client.close(None).await.ok();
    host.close(None).await.ok();
    Ok(())
  }
}
