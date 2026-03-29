mod api;

use axum::{
    routing::{get, post},
    Router,
};
use clap::Parser;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower_http::services::ServeDir;
use crate::api::AppState;
use crate::api::bug_id_cache::BugIdCache;

#[derive(Parser)]
struct Args {
    /// Root directory for bug data.
    #[arg(short, long)]
    root: PathBuf,
    /// Port to listen on.
    #[arg(short, long, default_value = "8080")]
    port: u16,
    /// Directory containing frontend static files.
    #[arg(short, long, default_value = "../frontend/public")]
    frontend_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Ensure root directory exists.
    if !args.root.exists() {
        fs::create_dir_all(&args.root)?;
    }

    // Ensure the "default" directory exists within the root.
    let default_dir = args.root.join("default");
    if !default_dir.exists() {
        fs::create_dir_all(&default_dir)?;
    }

    // Load and update the bug ID cache.
    let cache = BugIdCache::load_and_update(&args.root);

    let shared_state = Arc::new(AppState {
        root: args.root.clone(),
        cache: Mutex::new(cache),
    });

    let app = Router::new()
        .route("/api/bug_list", get(api::get_bug_list))
        .route("/api/bug/:id", get(api::get_bug))
        .route("/api/bug/:id/comment", post(api::submit_comment))
        .route("/api/bug/:id/metadata", post(api::change_metadata))
        .fallback_service(ServeDir::new(args.frontend_dir))
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", args.port)).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}
