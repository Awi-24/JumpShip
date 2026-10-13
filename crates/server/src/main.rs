//! `jumpship-server [addr]` (default `JUMPSHIP_ADDR` or 127.0.0.1:8000, the port Vite proxies `/api` to).

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt::init();
    let addr = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("JUMPSHIP_ADDR").ok())
        .unwrap_or_else(|| "127.0.0.1:8000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    tracing::info!("JumpShip API on http://{addr}");
    let cfg = jumpship_server::config::Config::from_env();
    axum::serve(listener, jumpship_server::app(cfg)).await.expect("serve");
}
