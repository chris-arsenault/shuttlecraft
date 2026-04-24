use std::net::SocketAddr;

use sulion::secret_broker::{app, BrokerConfig, BrokerState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sulion=debug".into()),
        )
        .init();

    let config = BrokerConfig::from_env()?;
    let state = BrokerState::from_config(&config).await?;
    let addr: SocketAddr = config.listen;
    tracing::info!(listen = %addr, "starting sulion secret broker");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app(state)).await?;
    Ok(())
}
