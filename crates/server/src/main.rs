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
    if cfg.secret_key == "dev-secret-change-me-in-production" {
        if !cfg.debug {
            eprintln!(
                "SECRET_KEY is still the default dev value. Set SECRET_KEY in .env,                  or set DEBUG=true to allow the default in development."
            );
            std::process::exit(1);
        }
        tracing::error!("SECRET_KEY is using default dev value (DEBUG=true). Do not deploy this way.");
    }
    let db = jumpship_server::db::Db::open(&cfg.database_url).expect("open database");
    axum::serve(listener, jumpship_server::app(cfg, db))
        .await
        .expect("serve");
}
