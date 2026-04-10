mod api;
mod fake_data;
mod bug_id_cache;
mod component_id_cache;

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

use crate::bug_id_cache::BugIdCache;
use crate::component_id_cache::ComponentIdCache;

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
    /// Whether to generate fake data upon startup.
    #[arg(long, default_value = "false")]
    fake_data: bool,
    /// Create a new root component with the given name and exit.
    #[arg(long = "CreateRootComponent")]
    create_root_component: Option<String>,
    /// The user ID of the admin for the new root component. Required with --CreateRootComponent.
    #[arg(long = "AdminUserId", requires = "create_root_component")]
    admin_user_id: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    // Ensure root directory exists.
    if !args.root.exists() {
        fs::create_dir_all(&args.root)?;
    }

    if let Some(name) = args.create_root_component {
        let admin_id = args.admin_user_id.expect("--AdminUserId is required when using --CreateRootComponent");
        create_root_component(&args.root, &name, &admin_id)?;
        return Ok(());
    }

    println!("Root directory: {:?}", args.root);
    println!("Frontend directory: {:?}", args.frontend_dir);
    println!("Port: {:?}", args.port);

    // Ensure the "default" directory exists within the root.
    let default_dir = args.root.join("default");
    if !default_dir.exists() {
        fs::create_dir_all(&default_dir)?;
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

    let shared_state = Arc::new(api::AppState {
        root: args.root.clone(),
        bug_cache: cache,
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    let index_file = args.frontend_dir.join("index.html");

    let app = Router::new()
        .route("/api/bug_list", get(api::get_bug_list))
        .route("/api/bug/:id", get(api::get_bug))
        .route("/api/bug/:id/state", get(api::get_bug_state))
        .route("/api/bug/:id/comment", post(api::submit_comment))
        .route("/api/bug/:id/metadata", post(api::change_metadata))
        .route("/api/component/:id/get_metadata", get(api::get_component_metadata))
        .route("/api/component/:id/update_metadata", post(api::update_component_metadata))
        .route("/api/component_list", get(api::get_component_list))
        .route("/api/create_component", post(api::create_component))
        .route("/api/create_bug", post(api::create_bug))
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

fn create_root_component(root: &Path, name: &str, admin_user_id: &str) -> anyhow::Result<()> {
    let safe_name = api::sanitize_name(name);
    let component_path = root.join(&safe_name);

    if component_path.exists() {
        anyhow::bail!("Component directory already exists: {:?}", component_path);
    }

    fs::create_dir_all(&component_path)?;

    // Load ID cache and generate new ID
    let mut component_cache = ComponentIdCache::default();
    component_cache.id_to_path.insert(0, "".to_string()); // Ensure root is known
    component_cache.update_from_disk(root);
    let new_id = component_cache.get_next_id();

    // Default groups setup (mirroring api.rs)
    let mut groups = HashMap::new();
    
    // Component Admins
    groups.insert("Component Admins".to_string(), api::GroupPermissions {
        permissions: vec![
            api::Permission::ComponentAdmin, api::Permission::CreateIssues, api::Permission::AdminIssues,
            api::Permission::EditIssues, api::Permission::CommentOnIssues, api::Permission::ViewIssues
        ],
        view_level: 999,
        members: vec![admin_user_id.to_string()],
    });

    // Issue Admins
    groups.insert("Issue Admins".to_string(), api::GroupPermissions {
        permissions: vec![
            api::Permission::CreateIssues, api::Permission::AdminIssues,
            api::Permission::EditIssues, api::Permission::CommentOnIssues, api::Permission::ViewIssues
        ],
        view_level: 500,
        members: vec![],
    });

    // Issue Editors
    groups.insert("Issue Editors".to_string(), api::GroupPermissions {
        permissions: vec![
            api::Permission::CreateIssues, api::Permission::EditIssues, 
            api::Permission::CommentOnIssues, api::Permission::ViewIssues
        ],
        view_level: 100,
        members: vec![],
    });

    // Issue Contributors
    groups.insert("Issue Contributors".to_string(), api::GroupPermissions {
        permissions: vec![
            api::Permission::CreateIssues, api::Permission::CommentOnIssues, api::Permission::ViewIssues
        ],
        view_level: 1,
        members: vec!["PUBLIC".to_string()],
    });

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?;

    let mut templates = HashMap::new();
    templates.insert("".to_string(), api::BugTemplate::default());

    let user_metadata: Vec<api::UserMetadataEntry> = vec![];

    let meta = api::ComponentMetadata {
        version: api::CURRENT_VERSION,
        id: new_id,
        name: name.to_string(),
        description: format!("Root component: {}", name),
        creator: admin_user_id.to_string(),
        bug_type: None,
        priority: None,
        severity: None,
        verifier: None,
        collaborators: vec![],
        cc: vec![],
        access_control: api::AccessControl { groups },
        templates,
        default_template: "".to_string(),
        user_metadata,
        created_at: now.as_nanos() as u64,
    };

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|e| anyhow::anyhow!("Serialization error: {:?}", e))?;
    fs::write(component_path.join("component_metadata"), bytes)?;

    println!("Successfully created root component '{}' with ID {} at {:?}", name, new_id, component_path);
    Ok(())
}
