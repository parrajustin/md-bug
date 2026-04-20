use clap::{Parser, ArgGroup};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use axum::extract::{State, Query, Path};
use axum::Json as ax_Json; // Alias to avoid confusion
use md_bug_backend::api::{self, AppState};
use md_bug_backend::bug_id_cache::BugIdCache;
use md_bug_backend::component_id_cache::ComponentIdCache;
use serde_json;
use axum::response::IntoResponse;
use http_body_util::BodyExt; // For collecting response body
use reqwest;
use http::StatusCode;

#[derive(Parser)]
#[command(name = "md-bug-cli")]
#[command(about = "CLI for md-bug API", long_about = "A command-line interface to interact with the md-bug backend API.")]
#[command(group(
    ArgGroup::new("api")
        .required(true)
        .args([
            "bug_list", "create_bug", "get_bug", "get_bug_state", "submit_comment", 
            "update_bug_metadata", "component_list", "create_component", 
            "get_component_metadata", "update_component_metadata", 
            "add_template", "modify_template", "delete_template"
        ]),
))]
#[command(group(
    ArgGroup::new("source")
        .required(true)
        .args(["root", "remote"]),
))]
struct Args {
    /// Root directory for bug data.
    #[arg(short, long)]
    root: Option<PathBuf>,

    /// Remote server address (e.g., 192.168.1.129:9090)
    #[arg(long)]
    remote: Option<String>,

    /// Bug ID for bug-specific operations.
    #[arg(long)]
    bug: Option<u32>,

    /// Component ID for component-specific operations.
    #[arg(long)]
    component: Option<u32>,

    /// List bugs. Optional JSON: {"q": "search term", "u": "username"}
    #[arg(long = "bug_list")]
    bug_list: Option<Option<String>>,

    /// Create a new bug. JSON: CreateBugRequest
    #[arg(long = "create_bug")]
    create_bug: Option<String>,

    /// Get bug details. Needs --bug. JSON: {"u": "username"}
    #[arg(long = "get_bug")]
    get_bug: Option<String>,

    /// Get bug state. Needs --bug. JSON: {"u": "username"}
    #[arg(long = "get_bug_state")]
    get_bug_state: Option<String>,

    /// Submit a comment. Needs --bug. JSON: CommentRequest
    #[arg(long = "submit_comment")]
    submit_comment: Option<String>,

    /// Update bug metadata. Needs --bug. JSON: MetadataChangeRequest
    #[arg(long = "update_bug_metadata")]
    update_bug_metadata: Option<String>,

    /// List components. JSON: {"u": "username"}
    #[arg(long = "component_list")]
    component_list: Option<String>,

    /// Create a component. JSON: CreateComponentRequest
    #[arg(long = "create_component")]
    create_component: Option<String>,

    /// Get component metadata. Needs --component. JSON: {"u": "username"}
    #[arg(long = "get_component_metadata")]
    get_component_metadata: Option<String>,

    /// Update component metadata. Needs --component. JSON: UpdateComponentMetadataRequest
    #[arg(long = "update_component_metadata")]
    update_component_metadata: Option<String>,

    /// Add a template. Needs --component. JSON: TemplateRequest
    #[arg(long = "add_template")]
    add_template: Option<String>,

    /// Modify a template. Needs --component. JSON: ModifyTemplateRequest
    #[arg(long = "modify_template")]
    modify_template: Option<String>,

    /// Delete a template. Needs --component. JSON: DeleteTemplateRequest
    #[arg(long = "delete_template")]
    delete_template: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if let Some(ref remote) = args.remote {
        return handle_remote(&args, remote).await;
    }

    let root = args.root.as_ref().ok_or_else(|| anyhow::anyhow!("--root or --remote required"))?;
    if !root.exists() {
        anyhow::bail!("Root directory does not exist: {:?}", root);
    }

    // Load and update caches
    let bug_cache = BugIdCache::load_and_update(root);
    let mut component_cache = ComponentIdCache::default();
    component_cache.update_from_disk(root);

    let state = Arc::new(AppState {
        root: root.clone(),
        bug_cache,
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    if let Some(ref val) = args.bug_list {
        let json_str = val.as_deref().unwrap_or("{\"u\": \"anonymous\"}");
        let query: api::SearchQuery = serde_json::from_str(json_str)?;
        let resp = api::get_bug_list(State(state), Query(query)).await;
        print_response(resp.into_response()).await?;
    } else if let Some(ref json_str) = args.create_bug {
        let payload: api::CreateBugRequest = serde_json::from_str(json_str)?;
        let resp = api::create_bug(State(state), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.get_bug {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let query: api::BugQuery = serde_json::from_str(json_str)?;
        let resp = api::get_bug(State(state), Path(id), Query(query)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.get_bug_state {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let query: api::BugQuery = serde_json::from_str(json_str)?;
        let resp = api::get_bug_state(State(state), Path(id), Query(query)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.submit_comment {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let payload: api::CommentRequest = serde_json::from_str(json_str)?;
        let resp = api::submit_comment(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.update_bug_metadata {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let payload: api::MetadataChangeRequest = serde_json::from_str(json_str)?;
        let resp = api::update_bug_metadata(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.component_list {
        let query: api::BugQuery = serde_json::from_str(json_str)?;
        let resp = api::get_component_list(State(state), Query(query)).await;
        print_response(resp.into_response()).await?;
    } else if let Some(ref json_str) = args.create_component {
        let payload: api::CreateComponentRequest = serde_json::from_str(json_str)?;
        let resp = api::create_component(State(state), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.get_component_metadata {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let query: api::BugQuery = serde_json::from_str(json_str)?;
        let resp = api::get_component_metadata(State(state), Path(id), Query(query)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.update_component_metadata {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: api::UpdateComponentMetadataRequest = serde_json::from_str(json_str)?;
        let resp = api::update_component_metadata(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.add_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: api::TemplateRequest = serde_json::from_str(json_str)?;
        let resp = api::add_template(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.modify_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: api::ModifyTemplateRequest = serde_json::from_str(json_str)?;
        let resp = api::modify_template(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else if let Some(ref json_str) = args.delete_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: api::DeleteTemplateRequest = serde_json::from_str(json_str)?;
        let resp = api::delete_template(State(state), Path(id), ax_Json(payload)).await;
        match resp {
            Ok(r) => print_response(r.into_response()).await?,
            Err(status) => anyhow::bail!("Error: {}", status),
        }
    } else {
        anyhow::bail!("Error no command executed!");
    }

    Ok(())
}

async fn print_response(resp: axum::response::Response) -> anyhow::Result<()> {
    let status = resp.status();
    let body_bytes = resp.into_body().collect().await?.to_bytes();
    let body_str = String::from_utf8_lossy(&body_bytes);
    print_formatted_response(status, &body_str)
}

fn print_formatted_response(status: StatusCode, body_str: &str) -> anyhow::Result<()> {
    if status.is_success() {
        if body_str.is_empty() {
            println!("Success (Empty Body)");
        } else {
            // Try to pretty print JSON if possible
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&body_str) {
                println!("{}", serde_json::to_string_pretty(&json_val)?);
            } else {
                println!("{}", body_str);
            }
        }
    } else {
        println!("Error: {} - {}", status, body_str);
    }
    Ok(())
}

async fn handle_remote(args: &Args, remote: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let base_url = if remote.starts_with("http") {
        format!("{}/api", remote)
    } else {
        format!("http://{}/api", remote)
    };

    let (resp_status, resp_text) = if let Some(ref val) = args.bug_list {
        let json_str = val.as_deref().unwrap_or("{\"u\": \"anonymous\"}");
        let query: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.get(format!("{}/bug_list", base_url)).query(&query).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.create_bug {
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/create_bug", base_url)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.get_bug {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let query: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.get(format!("{}/bug/{}", base_url, id)).query(&query).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.get_bug_state {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let query: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.get(format!("{}/bug/{}/state", base_url, id)).query(&query).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.submit_comment {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/bug/{}/comment", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.update_bug_metadata {
        let id = args.bug.ok_or_else(|| anyhow::anyhow!("--bug ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/bug/{}/update_metadata", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.component_list {
        let query: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.get(format!("{}/component_list", base_url)).query(&query).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.create_component {
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/create_component", base_url)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.get_component_metadata {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let query: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.get(format!("{}/component/{}/get_metadata", base_url, id)).query(&query).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.update_component_metadata {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/component/{}/update_metadata", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.add_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/component/{}/add_template", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.modify_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/component/{}/modify_template", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else if let Some(ref json_str) = args.delete_template {
        let id = args.component.ok_or_else(|| anyhow::anyhow!("--component ID required"))?;
        let payload: serde_json::Value = serde_json::from_str(json_str)?;
        let resp = client.post(format!("{}/component/{}/delete_template", base_url, id)).json(&payload).send().await?;
        (resp.status(), resp.text().await?)
    } else {
        anyhow::bail!("Error no command executed!");
    };

    let status = StatusCode::from_u16(resp_status.as_u16())?;
    print_formatted_response(status, &resp_text)?;
    Ok(())
}

