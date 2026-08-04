use md_bug_backend::api;
use md_bug_backend::api_auth;
use md_bug_backend::user::UserManager;
use md_bug_backend::fake_data;
use md_bug_backend::bug_id_cache::BugIdCache;
use md_bug_backend::component_id_cache::ComponentIdCache;

use axum::{
    routing::{get, post},
    Router,
};
use clap::Parser;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Parser)]
struct Args {
    /// Root directory for bug data.
    #[arg(short, long, env = "BUG_ROOT")]
    root: PathBuf,
    /// Port to listen on.
    #[arg(short, long, default_value = "8080", env = "BUG_PORT")]
    port: u16,
    /// Directory containing frontend static files.
    #[arg(short, long, default_value = "../frontend/public", env = "FRONTEND_DIR")]
    frontend_dir: PathBuf,
    /// Whether to generate fake data upon startup.
    #[arg(long, default_value = "false", env = "GENERATE_FAKE_DATA")]
    fake_data: bool,
    /// Create a new root component with the given name and exit.
    #[arg(long = "CreateRootComponent", env = "CREATE_ROOT_COMPONENT")]
    create_root_component: Option<String>,
    /// The user ID of the admin for the new root component. Required with --CreateRootComponent.
    #[arg(long = "AdminUserId", requires = "create_root_component", env = "ADMIN_USER_ID")]
    admin_user_id: Option<String>,
    /// Username of the bootstrap administrator, created on first run.
    #[arg(long = "AdminUsername", env = "ADMIN_USERNAME", default_value = "admin")]
    admin_username: String,
    /// Create a user with the given name and exit. Prompts for the password on stdin.
    #[arg(long = "CreateUser", env = "CREATE_USER")]
    create_user: Option<String>,
    /// Grant admin rights to the user created by --CreateUser.
    #[arg(long = "CreateAdmin", requires = "create_user")]
    create_admin: bool,
}

/// Creates the bootstrap administrator if no accounts exist yet.
///
/// The generated password is printed once and never stored in plaintext. The account is
/// flagged `must_change_password`, so it can do nothing except rotate that password —
/// which means a console log scrolling past in CI is not a lasting foothold.
async fn bootstrap_admin(users: &UserManager, username: &str) -> anyhow::Result<()> {
    if users.count_users().await? > 0 {
        return Ok(());
    }

    let password = md_bug_backend::auth::generate_secret();
    users
        .create_user(
            username,
            None,
            Some(&password),
            /*is_admin=*/ true,
            /*must_change_password=*/ true,
        )
        .await?;

    println!();
    println!("╔══════════════════════════════════════════════════════════════════╗");
    println!("║  Bootstrap administrator created — this is shown only once.      ║");
    println!("╚══════════════════════════════════════════════════════════════════╝");
    println!("  username: {username}");
    println!("  password: {password}");
    println!();
    println!("  You must change this password on first login; the account cannot");
    println!("  do anything else until you do.");
    println!();

    Ok(())
}

/// Reads a password twice from the terminal without echoing it.
fn prompt_new_password() -> anyhow::Result<String> {
    let password = rpassword::prompt_password("New password: ")?;
    if password.len() < 8 {
        anyhow::bail!("Password must be at least 8 characters");
    }
    let confirm = rpassword::prompt_password("Confirm password: ")?;
    if password != confirm {
        anyhow::bail!("Passwords do not match");
    }
    Ok(password)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Ensure root directory exists.
    if !args.root.exists() {
        fs::create_dir_all(&args.root)?;
    }

    // --CreateUser runs against the account store and exits, like --CreateRootComponent.
    // The password is read from the terminal rather than an argument so it never lands
    // in shell history or the process list.
    if let Some(new_user) = args.create_user.clone() {
        let users = UserManager::new(&args.root.join("users.json")).await?;
        bootstrap_admin(&users, &args.admin_username).await?;

        if users.has_username(&new_user).await {
            anyhow::bail!("User '{new_user}' already exists");
        }
        let password = prompt_new_password()?;
        users
            .create_user(
                &new_user,
                None,
                Some(&password),
                args.create_admin,
                /*must_change_password=*/ false,
            )
            .await?;
        println!(
            "Created {}user '{new_user}'.",
            if args.create_admin { "admin " } else { "" }
        );
        return Ok(());
    }

    if let Some(name) = args.create_root_component {
        let admin_id = args.admin_user_id.expect("--AdminUserId is required when using --CreateRootComponent");
        create_root_component(&args.root, &name, &admin_id)?;
        return Ok(());
    }

    println!("Root directory: {:?}", args.root);
    println!("Frontend directory: {:?}", args.frontend_dir);
    println!("Port: {:?}", args.port);

    // Ensure a usable top-level component exists. A fresh install otherwise has nothing
    // to nest under and nowhere to file a bug. Owned by the bootstrap admin, so the two
    // first-start steps stay consistent.
    match api::ensure_default_component(&args.root, &args.admin_username)? {
        Some(id) => println!(
            "Created default component '{}' with ID {}",
            api::DEFAULT_COMPONENT_NAME, id
        ),
        None => tracing::debug!("default component already present"),
    }

    // Generate fake data if the flag is set.
    if args.fake_data {
        fake_data::generate_fake_data(&args.root);
    }

    // Load and update the bug ID cache.
    let cache = BugIdCache::load_and_update(&args.root);

    // Load and update the component ID cache.
    let mut component_cache = ComponentIdCache::default();
    component_cache.update_from_disk(&args.root);

    // Accounts live alongside the bug data so a deployment is one directory.
    let users = Arc::new(UserManager::new(&args.root.join("users.json")).await?);
    bootstrap_admin(&users, &args.admin_username).await?;
    if let Ok(pruned) = users.prune_expired_tokens().await {
        if pruned > 0 {
            tracing::info!("pruned {pruned} expired token(s)");
        }
    }

    let shared_state = Arc::new(api::AppState {
        root: args.root.clone(),
        bug_cache: cache,
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
        users: users.clone(),
    });

    let index_file = args.frontend_dir.join("index.html");

    let app = Router::new()
        // Auth routes are the only ones reachable without a bearer token — everything
        // else takes a `RequestUser` extractor, which rejects unauthenticated callers.
        .route("/api/auth/login", post(api_auth::login))
        .route("/api/auth/refresh", post(api_auth::refresh))
        .route("/api/auth/change_password", post(api_auth::change_password))
        .route("/api/auth/logout", post(api_auth::logout))
        .route("/api/auth/me", get(api_auth::me))
        .route(
            "/api/auth/users",
            post(api_auth::create_user).get(api_auth::list_users),
        )
        .route(
            "/api/auth/tokens",
            post(api_auth::create_api_token).get(api_auth::list_api_tokens),
        )
        .route(
            "/api/auth/tokens/:id",
            axum::routing::delete(api_auth::revoke_api_token),
        )
        .route(
            "/api/auth/users/:username/disabled",
            post(api_auth::set_user_disabled),
        )
        .route(
            "/api/auth/bots",
            post(api_auth::create_bot_token).get(api_auth::list_bot_tokens),
        )
        .route(
            "/api/auth/bots/:id",
            axum::routing::delete(api_auth::revoke_bot_token),
        )
        .route("/api/bug_list", get(api::get_bug_list))
        .route("/api/create_bug", post(api::create_bug))
        .route("/api/bug/:id", get(api::get_bug))
        .route("/api/bug/:id/state", get(api::get_bug_state))
        .route("/api/bug/:id/comment", post(api::submit_comment))
        .route("/api/bug/:id/update_metadata", post(api::update_bug_metadata))
        .route("/api/component_list", get(api::get_component_list))
        .route("/api/create_component", post(api::create_component))
        .route("/api/create_root_component", post(api::create_root_component))
        .route("/api/component/:id/get_metadata", get(api::get_component_metadata))
        .route("/api/component/:id/update_metadata", post(api::update_component_metadata))
        .route("/api/component/:id/add_template", post(api::add_template))
        .route("/api/component/:id/modify_template", post(api::modify_template))
        .route("/api/component/:id/delete_template", post(api::delete_template))
        .fallback_service(
            ServeDir::new(&args.frontend_dir)
                .not_found_service(ServeFile::new(index_file))
        )
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", args.port)).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;

    Ok(())
}

/// Bootstraps a root component from the CLI.
///
/// The actual disk write lives in `api::write_root_component`, shared with the
/// `create_root_component` endpoint so the two cannot produce different ACLs.
fn create_root_component(root: &Path, name: &str, admin_user_id: &str) -> anyhow::Result<()> {
    // Ids come from a scan of what is already on disk; there is no running server whose
    // cache we could consult.
    let mut component_cache = ComponentIdCache::default();
    component_cache.id_to_path.insert(0, "".to_string());
    component_cache.update_from_disk(root);
    let new_id = component_cache.get_next_id();

    let description = format!("Root component: {}", name);
    let created = api::write_root_component(root, new_id, name, &description, admin_user_id)?;

    println!(
        "Successfully created root component '{}' with ID {} at {:?}",
        name,
        new_id,
        root.join(created)
    );
    Ok(())
}
