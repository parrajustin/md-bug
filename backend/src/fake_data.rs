use std::fs;
use std::path::Path;
use rand::Rng;
use fake::Fake;
use fake::faker::lorem::en::{Sentence, Paragraph};
use fake::faker::internet::en::SafeEmail;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use crate::api::{BugMetadata, Comment, AccessMetadata, ComponentMetadata, AccessControl, GroupPermissions, Permission, CURRENT_VERSION};
use walkdir::WalkDir;

pub fn generate_fake_data(root: &Path) {
    let mut rng = rand::thread_rng();
    
    // Find the current max bug ID to avoid collisions
    let mut max_id = 0;
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                if let Ok(id) = name.parse::<u32>() {
                    if id > max_id {
                        max_id = id;
                    }
                }
            }
        }
    }

    let num_bugs = rng.gen_range(10..40);
    println!("Generating {} fake bugs...", num_bugs);

    let components_pool = vec![
        "Frontend", "Backend", "UI", "Database", "Auth", "Security", "Network", "API", "Mobile", "Desktop",
        "Performance", "Documentation", "Testing", "DevOps", "Infrastructure"
    ];

    let users_pool = vec![
        "admin", "alice", "bob", "charlie", "dave", "eve", "frank", "grace", "heidi", "ivan", "judy", "mallory"
    ];

    let priorities = ["P0", "P1", "P2", "P3", "P4"];
    let severities = ["S0", "S1", "S2", "S3", "S4"];
    let statuses = ["New", "Assigned", "Fixed", "Verified", "Duplicate", "WontFix"];
    let types = ["Bug", "Feature", "Task"];

    let mut next_comp_id = 1;
    // Find current max component ID
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_name() == "component_metadata" {
            if let Ok(data) = fs::read(entry.path()) {
                if let Ok(meta) = crate::api::read_versioned::<ComponentMetadata>(&data) {
                    if meta.id >= next_comp_id {
                        next_comp_id = meta.id + 1;
                    }
                }
            }
        }
    }

    for i in 1..=num_bugs {
        let bug_id = max_id + i;

        // Pick 1 to 3 random components to form a folder path
        let num_components = rng.gen_range(1..=3);
        let mut folders = Vec::new();
        for _ in 0..num_components {
            let comp = components_pool[rng.gen_range(0..components_pool.len())].to_string();
            folders.push(comp);
        }

        let mut current_path = root.to_path_buf();
        let mut last_comp_id = 0;
        for f in &folders {
            current_path.push(f);
            if let Err(e) = fs::create_dir_all(&current_path) {
                eprintln!("Failed to create component directory: {}", e);
                continue;
            }

            let meta_file = current_path.join("component_metadata");
            if !meta_file.exists() {
                let mut templates = HashMap::new();
                templates.insert("".to_string(), crate::api::BugTemplate::default());

                // Create standard groups
                let mut groups = HashMap::new();
                groups.insert("Component Admins".to_string(), GroupPermissions {
                    permissions: vec![
                        Permission::ComponentAdmin, Permission::CreateIssues, Permission::AdminIssues,
                        Permission::EditIssues, Permission::CommentOnIssues, Permission::ViewIssues
                    ],
                    view_level: 999,
                    members: vec![users_pool[rng.gen_range(0..users_pool.len())].to_string()],
                });
                groups.insert("Issue Admins".to_string(), GroupPermissions {
                    permissions: vec![
                        Permission::CreateIssues, Permission::AdminIssues,
                        Permission::EditIssues, Permission::CommentOnIssues, Permission::ViewIssues
                    ],
                    view_level: 500,
                    members: vec![users_pool[rng.gen_range(0..users_pool.len())].to_string()],
                });
                groups.insert("Issue Editors".to_string(), GroupPermissions {
                    permissions: vec![
                        Permission::CreateIssues, Permission::EditIssues, 
                        Permission::CommentOnIssues, Permission::ViewIssues
                    ],
                    view_level: 100,
                    members: vec![],
                });
                groups.insert("Issue Contributors".to_string(), GroupPermissions {
                    permissions: vec![
                        Permission::CreateIssues, Permission::CommentOnIssues, Permission::ViewIssues
                    ],
                    view_level: 1,
                    members: vec!["PUBLIC".to_string()],
                });

                let comp_meta = ComponentMetadata {
                    version: CURRENT_VERSION,
                    id: next_comp_id,
                    name: f.clone(),
                    description: format!("Description for component {}", f),
                    creator: users_pool[rng.gen_range(0..users_pool.len())].to_string(),
                    bug_type: Some(types[rng.gen_range(0..types.len())].to_string()),
                    priority: Some(priorities[rng.gen_range(0..priorities.len())].to_string()),
                    severity: Some(severities[rng.gen_range(0..severities.len())].to_string()),
                    verifier: Some(users_pool[rng.gen_range(0..users_pool.len())].to_string()),
                    collaborators: vec![users_pool[rng.gen_range(0..users_pool.len())].to_string()],
                    cc: vec![users_pool[rng.gen_range(0..users_pool.len())].to_string()],
                    access_control: AccessControl { groups },
                    templates,
                    default_template: "".to_string(),
                    user_metadata: vec![],
                    created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
                };
                if let Ok(bytes) = rkyv::to_bytes::<_, 2048>(&comp_meta) {
                    let _ = fs::write(meta_file, bytes);
                    last_comp_id = next_comp_id;
                    next_comp_id += 1;
                }
            } else {
                // Read existing ID
                if let Ok(data) = fs::read(&meta_file) {
                    if let Ok(meta) = crate::api::read_versioned::<ComponentMetadata>(&data) {
                        last_comp_id = meta.id;
                    }
                }
            }
        }

        let mut bug_path = current_path.clone();
        bug_path.push(bug_id.to_string());

        if let Err(e) = fs::create_dir_all(&bug_path) {
            eprintln!("Failed to create bug directory: {}", e);
            continue;
        }

        let metadata = BugMetadata {
            version: CURRENT_VERSION,
            id: bug_id,
            reporter: users_pool[rng.gen_range(0..users_pool.len())].to_string(),
            bug_type: types[rng.gen_range(0..types.len())].to_string(),
            priority: priorities[rng.gen_range(0..priorities.len())].to_string(),
            severity: severities[rng.gen_range(0..severities.len())].to_string(),
            status: statuses[rng.gen_range(0..statuses.len())].to_string(),
            assignee: users_pool[rng.gen_range(0..users_pool.len())].to_string(),
            verifier: users_pool[rng.gen_range(0..users_pool.len())].to_string(),
            collaborators: vec![
                users_pool[rng.gen_range(0..users_pool.len())].to_string(),
                users_pool[rng.gen_range(0..users_pool.len())].to_string()
            ],
            cc: vec![users_pool[rng.gen_range(0..users_pool.len())].to_string()],
            access: AccessMetadata::default(),
            title: Sentence(3..8).fake(),
            component_id: last_comp_id,
            description: Paragraph(1..5).fake(),
            user_metadata: vec![],
            created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
            state_id: 1,
        };

        if let Ok(bytes) = rkyv::to_bytes::<_, 8192>(&metadata) {
            let _ = fs::write(bug_path.join("metadata"), bytes);
        }

        let num_comments = rng.gen_range(1..6);
        for c_id in 1..=num_comments {
            let comment = Comment {
                version: CURRENT_VERSION,
                id: c_id as u32,
                author: users_pool[rng.gen_range(0..users_pool.len())].to_string(),
                epoch_nanoseconds: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
                content: Paragraph(1..3).fake(),
            };

            if let Ok(bytes) = rkyv::to_bytes::<_, 1024>(&comment) {
                let _ = fs::write(bug_path.join(format!("comment_{:07}", c_id)), bytes);
            }
        }
    }
}
