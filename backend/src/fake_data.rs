use std::fs;
use std::path::Path;
use rand::Rng;
use fake::Fake;
use fake::faker::lorem::en::{Sentence, Paragraph};
use fake::faker::internet::en::SafeEmail;
use std::time::{SystemTime, UNIX_EPOCH};
use crate::api::{BugMetadata, Comment};
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

    for i in 1..=num_bugs {
        let bug_id = max_id + i;

        // Pick 1 to 3 random components to form a folder path
        let num_components = rng.gen_range(1..=3);
        let mut folders = Vec::new();
        for _ in 0..num_components {
            let comp = components_pool[rng.gen_range(0..components_pool.len())].to_string();
            folders.push(comp);
        }

        let mut bug_path = root.to_path_buf();
        for f in &folders {
            bug_path.push(f);
        }
        bug_path.push(bug_id.to_string());

        if let Err(e) = fs::create_dir_all(&bug_path) {
            eprintln!("Failed to create bug directory: {}", e);
            continue;
        }

        let metadata = BugMetadata {
            id: bug_id,
            reporter: SafeEmail().fake(),
            bug_type: types[rng.gen_range(0..types.len())].to_string(),
            priority: priorities[rng.gen_range(0..priorities.len())].to_string(),
            severity: severities[rng.gen_range(0..severities.len())].to_string(),
            status: statuses[rng.gen_range(0..statuses.len())].to_string(),
            assignee: SafeEmail().fake(),
            title: Sentence(3..8).fake(),
            folders,
            description: Paragraph(1..5).fake(),
            user_metadata: vec![],
            created_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0),
        };

        if let Ok(bytes) = rkyv::to_bytes::<_, 1024>(&metadata) {
            let _ = fs::write(bug_path.join("metadata"), bytes);
        }

        let num_comments = rng.gen_range(0..5);
        for c_id in 1..=num_comments {
            let comment = Comment {
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
