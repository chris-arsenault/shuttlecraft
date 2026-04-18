use std::net::SocketAddr;

use shuttlecraft::app;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let listen: SocketAddr = std::env::var("SHUTTLECRAFT_LISTEN")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()?;

    tracing::info!(%listen, "shuttlecraft starting");

    let listener = tokio::net::TcpListener::bind(listen).await?;
    axum::serve(listener, app()).await?;
    Ok(())
}
