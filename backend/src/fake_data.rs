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

    let num_bugs = rng.gen_range(10..30);
    println!("Generating {} fake bugs...", num_bugs);

    let components_pool = vec![
        "Frontend", "Backend", "UI", "Database", "Auth", "Security", "Network", "API", "Mobile", "Desktop"
    ];

    let priorities = ["P0", "P1", "P2", "P3", "P4"];
    let severities = ["S0", "S1", "S2", "S3", "S4"];
    let statuses = ["New", "Assigned", "Fixed", "Verified"];
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
        for f in &folders {
            current_path.push(f);
            if let Err(e) = fs::create_dir_all(&current_path) {
                eprintln!("Failed to create component directory: {}", e);
                continue;
            }

            // 50/50 chance to create component metadata if it doesn't exist
            let meta_file = current_path.join("component_metadata");
            if !meta_file.exists() && rng.gen_bool(0.5) {
                let mut templates = HashMap::new();
                templates.insert("".to_string(), crate::api::BugTemplate::default());

                let comp_meta = ComponentMetadata {
                    version: CURRENT_VERSION,
                    id: next_comp_id,
                    name: f.clone(),
                    description: format!("Description for component {}", f),
                    creator: SafeEmail().fake(),
                    bug_type: Some(types[rng.gen_range(0..types.len())].to_string()),
                    priority: Some(priorities[rng.gen_range(0..priorities.len())].to_string()),
                    severity: Some(severities[rng.gen_range(0..severities.len())].to_string()),
                    verifier: Some(SafeEmail().fake()),
                    collaborators: vec![SafeEmail().fake()],
                    cc: vec![SafeEmail().fake()],
                    access_control: AccessControl { groups: {
                        let mut g = HashMap::new();
                        g.insert("Component Admins".to_string(), GroupPermissions {
                            permissions: vec![Permission::ComponentAdmin, Permission::ViewIssues],
                            view_level: 999,
                            members: vec![SafeEmail().fake()],
                        });
                        g
                    }},
                    templates,
                    default_template: "".to_string(),
                    user_metadata: vec![],
                    created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
                };
                if let Ok(bytes) = rkyv::to_bytes::<_, 1024>(&comp_meta) {
                    let _ = fs::write(meta_file, bytes);
                    next_comp_id += 1;
                }
            }
        }

        let mut bug_path = current_path.clone();
        bug_path.push(bug_id.to_string());

        if let Err(e) = fs::create_dir_all(&bug_path) {
            eprintln!("Failed to create bug directory: {}", e);
            continue;
        }

        let mut comment_access = vec![SafeEmail().fake()];
        let mut view_access = vec![SafeEmail().fake()];
        if rng.gen_bool(0.5) {
            comment_access.push("PUBLIC".to_string());
        } else {
            view_access.push("PUBLIC".to_string());
        }

        let metadata = BugMetadata {
            version: CURRENT_VERSION,
            id: bug_id,
            reporter: SafeEmail().fake(),
            bug_type: types[rng.gen_range(0..types.len())].to_string(),
            priority: priorities[rng.gen_range(0..priorities.len())].to_string(),
            severity: severities[rng.gen_range(0..severities.len())].to_string(),
            status: statuses[rng.gen_range(0..statuses.len())].to_string(),
            assignee: SafeEmail().fake(),
            verifier: SafeEmail().fake(),
            collaborators: vec![SafeEmail().fake(), SafeEmail().fake()],
            cc: vec![SafeEmail().fake()],
            access: AccessMetadata {
                version: CURRENT_VERSION,
                full_access: vec![SafeEmail().fake()],
                comment_access,
                view_access,
            },
            title: Sentence(3..8).fake(),
            folders,
            description: Paragraph(1..5).fake(),
            user_metadata: vec![],
            created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
            state_id: 1,
        };

        if let Ok(bytes) = rkyv::to_bytes::<_, 1024>(&metadata) {
            let _ = fs::write(bug_path.join("metadata"), bytes);
        }

        let num_comments = rng.gen_range(0..5);
        for c_id in 1..=num_comments {
            let comment = Comment {
                version: CURRENT_VERSION,
                id: c_id as u32,
                author: SafeEmail().fake(),
                epoch_nanoseconds: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
                content: Paragraph(1..3).fake(),
            };

            if let Ok(bytes) = rkyv::to_bytes::<_, 256>(&comment) {
                let _ = fs::write(bug_path.join(format!("comment_{:07}", c_id)), bytes);
            }
        }
    }
}
