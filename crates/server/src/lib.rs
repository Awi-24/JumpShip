//! JumpShip HTTP server: the FastAPI backend's HTTP API (docs/rust-migration/API.md) on axum, so the React
//! frontend runs unchanged against either implementation.

pub mod applications;
pub mod config;
pub mod db;
pub mod error;
pub mod interview;
pub mod jobs;
pub mod llm;
pub mod models;
pub mod profile;
pub mod web_search;

use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderName, HeaderValue};
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub http: reqwest::Client,
    pub db: Arc<db::Db>,
    pub secrets: Arc<db::Secrets>,
}

pub fn app(cfg: Config, db: db::Db) -> Router {
    let origins = if cfg.cors_origins.iter().any(|o| o == "*") {
        AllowOrigin::mirror_request()
    } else {
        AllowOrigin::list(cfg.cors_origins.iter().filter_map(|o| HeaderValue::from_str(o).ok()))
    };
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .expose_headers([HeaderName::from_static("x-source-status")]);
    let state = AppState {
        secrets: Arc::new(db::Secrets::new(&cfg.secret_key)),
        cfg: Arc::new(cfg),
        http: jumpship_sources::client(),
        db: Arc::new(db),
    };
    Router::new()
        .merge(models::routes())
        .merge(jobs::routes())
        .merge(profile::routes())
        .merge(applications::routes())
        .merge(interview::routes())
        .with_state(state)
        .layer(cors)
}
