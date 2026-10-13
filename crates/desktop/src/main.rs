//! JumpShip desktop: runs `jumpship-server` in-process on a random localhost port and opens a Tauri window on it.
//! The server also serves the React build (embedded by Tauri from `frontend/dist`), so the page and `/api` share one
//! origin and the frontend runs unchanged (relative `/api/...` URLs, no CORS).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

use axum::http::{StatusCode, Uri, header};
use axum::response::IntoResponse;
use jumpship_server::config::Config;
use jumpship_server::db::Db;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_SECRET: &str = "dev-secret-change-me-in-production";

/// The Fernet secret for stored API keys: `SECRET_KEY` if set, else a random one kept in the OS keychain.
fn secret_key(data_dir: &Path) -> String {
    if let Ok(k) = std::env::var("SECRET_KEY")
        && !k.is_empty()
        && k != DEFAULT_SECRET
    {
        return k;
    }
    let fresh = || format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    match keyring::Entry::new("JumpShip", "secret-key") {
        Ok(entry) => match entry.get_password() {
            Ok(k) => return k,
            Err(keyring::Error::NoEntry) => {
                let k = fresh();
                if entry.set_password(&k).is_ok() {
                    return k;
                }
            }
            Err(e) => tracing::warn!("keychain unavailable: {e}"),
        },
        Err(e) => tracing::warn!("keychain unavailable: {e}"),
    }
    // ponytail: no usable keychain (e.g. Linux without a secret service): keep the secret beside the database.
    let file = data_dir.join("secret.key");
    std::fs::read_to_string(&file).unwrap_or_else(|_| {
        let k = fresh();
        let _ = std::fs::write(&file, &k);
        k
    })
}

/// Server config: environment as for the standalone server, with data paths defaulting to the app data dir.
fn config(data_dir: &Path) -> Config {
    let mut cfg = Config::from_env();
    if std::env::var("DATABASE_URL").is_err() {
        cfg.database_url = data_dir.join("jobspy_ui.db").to_string_lossy().into_owned();
    }
    if std::env::var("RESUME_OUTPUT_DIR").is_err() {
        cfg.resume_output_dir = data_dir.join("generated_resumes").to_string_lossy().into_owned();
    }
    cfg.secret_key = secret_key(data_dir);
    cfg
}

fn init_logging(data_dir: &Path) {
    let file = std::fs::File::create(data_dir.join("jumpship.log"));
    let builder = tracing_subscriber::fmt().with_ansi(false);
    match file {
        Ok(f) => builder.with_writer(std::sync::Mutex::new(f)).init(),
        Err(_) => builder.init(),
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            init_logging(&data_dir);
            let cfg = config(&data_dir);
            let db = Db::open(&cfg.database_url)?;

            // The SPA from Tauri's embedded assets; unknown paths get index.html (client-side routes).
            let assets = std::sync::Arc::new(app.asset_resolver());
            let spa = move |uri: Uri| {
                let assets = assets.clone();
                async move {
                    let path = match uri.path().trim_start_matches('/') {
                        "" => "index.html",
                        p => p,
                    };
                    let asset = assets.get(path.to_string()).or_else(|| assets.get("index.html".into()));
                    match asset {
                        Some(a) => ([(header::CONTENT_TYPE, a.mime_type)], a.bytes).into_response(),
                        None => StatusCode::NOT_FOUND.into_response(),
                    }
                }
            };
            let router = jumpship_server::app(cfg, db).fallback(spa);

            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let url = format!("http://127.0.0.1:{}/", listener.local_addr()?.port());
            tracing::info!("JumpShip server on {url}");
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
                if let Err(e) = axum::serve(listener, router).await {
                    tracing::error!("server stopped: {e}");
                }
            });

            let home = url.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("JumpShip")
                .inner_size(1360.0, 900.0)
                .min_inner_size(900.0, 600.0)
                // Job links and other sites open in the system browser, not inside the app.
                .on_navigation(move |u| {
                    let local = u.as_str().starts_with(&home);
                    if !local && matches!(u.scheme(), "http" | "https") {
                        let _ = open::that(u.as_str());
                    }
                    local || !matches!(u.scheme(), "http" | "https")
                })
                .on_new_window(|u, _| {
                    let _ = open::that(u.as_str());
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running JumpShip");
}
