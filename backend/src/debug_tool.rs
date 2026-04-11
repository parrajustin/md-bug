use clap::Parser;
use std::path::PathBuf;
use md_bug_backend::api::{AppState, BugMetadata, Comment, read_versioned, resolve_component_metadata, find_bug_path};
use md_bug_backend::bug_id_cache::BugIdCache;
use md_bug_backend::component_id_cache::ComponentIdCache;
use std::sync::Mutex;
use std::collections::HashMap;
use std::fs;

#[derive(Parser)]
struct Args {
    /// Root directory for bug data.
    #[arg(short, long)]
    root: PathBuf,

    /// Bug ID to print information for.
    #[arg(short, long)]
    bug_id: Option<u32>,

    /// Component ID.
    #[arg(short, long)]
    component_id: Option<u32>,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Load and update the bug ID cache.
    let cache = BugIdCache::load_and_update(&args.root);

    // Load and update the component ID cache.
    let mut component_cache = ComponentIdCache::default();
    component_cache.update_from_disk(&args.root);

    let state = AppState {
        root: args.root.clone(),
        bug_cache: cache,
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    };

    if let Some(bug_id) = args.bug_id {
        // Print bug info
        let bug_path = find_bug_path(&state, bug_id).ok_or_else(|| anyhow::anyhow!("Bug {} not found", bug_id))?;
        let metadata_data = fs::read(bug_path.join("metadata"))?;
        let metadata: BugMetadata = read_versioned::<BugMetadata>(&metadata_data).map_err(|e| anyhow::anyhow!(e))?;

        println!("--- Bug Metadata (ID: {}) ---", bug_id);
        println!("{:#?}", metadata);

        println!("\n--- Comments ---");
        let mut comments = Vec::new();
        if let Ok(dir) = fs::read_dir(&bug_path) {
            for entry in dir.filter_map(|e| e.ok()) {
                let name = entry.file_name().into_string().unwrap_or_default();
                if name.starts_with("comment_") {
                    let data = fs::read(entry.path())?;
                    let comment: Comment = read_versioned::<Comment>(&data).map_err(|e| anyhow::anyhow!(e))?;
                    comments.push(comment);
                }
            }
        }
        comments.sort_by_key(|c| c.id);
        for comment in comments {
            println!("{:#?}", comment);
        }
    } else if let Some(comp_id) = args.component_id {
        // Print component info
        let path = {
            let cache = state.component_cache.lock().unwrap();
            cache.get_path(comp_id).ok_or_else(|| anyhow::anyhow!("Component {} not found", comp_id))?
        };
        let resolved = resolve_component_metadata(&state.root, &path);
        println!("--- Resolved Component Metadata (ID: {}) ---", comp_id);
        println!("{:#?}", resolved);

        println!("\n--- Bugs in this component ---");
        let component_path = state.root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let mut bug_summaries = Vec::new();
        if let Ok(dir) = fs::read_dir(&component_path) {
            for entry in dir.filter_map(|e| e.ok()) {
                if entry.file_type()?.is_dir() {
                    let name = entry.file_name().into_string().unwrap_or_default();
                    if name.parse::<u32>().is_ok() {
                        let metadata_file = entry.path().join("metadata");
                        if metadata_file.exists() {
                            let data = fs::read(metadata_file)?;
                            if let Ok(metadata) = read_versioned::<BugMetadata>(&data) {
                                bug_summaries.push((metadata.id, metadata.title));
                            }
                        }
                    }
                }
            }
        }
        bug_summaries.sort_by_key(|b| b.0);
        for (id, title) in bug_summaries {
            println!("ID: {}, Title: {}", id, title);
        }
    } else {
        // Print all components
        println!("--- All Components ---");
        let cache = state.component_cache.lock().unwrap();
        let mut list: Vec<_> = cache.id_to_path.iter().collect();
        list.sort_by_key(|(id, _)| *id);
        for (id, path) in list {
            println!("ID: {}, Path: {}", id, path);
        }
    }

    Ok(())
}
