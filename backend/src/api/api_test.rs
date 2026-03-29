use super::*;
use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::Json;
use tempfile::tempdir;
use std::fs;
use std::sync::{Arc, Mutex};
use std::path::Path as StdPath;
use axum::http::StatusCode;
use crate::api::bug_id_cache::BugIdCache;

fn create_test_bug(root: &StdPath, id: u32, folders: Vec<String>) -> anyhow::Result<std::path::PathBuf> {
    let mut bug_path = root.to_path_buf();
    for folder in &folders {
        bug_path.push(folder);
    }
    bug_path.push(id.to_string());
    fs::create_dir_all(&bug_path)?;

    let metadata = BugMetadata {
        id,
        reporter: "test@example.com".to_string(),
        bug_type: "Bug".to_string(),
        priority: "P1".to_string(),
        severity: "S1".to_string(),
        status: "New".to_string(),
        assignee: "none".to_string(),
        title: format!("Test Bug {}", id),
        folders,
        description: "Test bug description".to_string(),
        user_metadata: vec![],
        created_at: 123456789,
    };

    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(bug_path.join("metadata"), bytes)?;
    Ok(bug_path)
}

#[tokio::test]
async fn test_create_and_get_bug() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 1, vec!["google".to_string(), "sxs".to_string()])?;
    
    // Load cache after creating bug
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        cache: Mutex::new(cache),
    });

    let response = get_bug(State(state.clone()), Path(1)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);
    Ok(())
}

#[tokio::test]
async fn test_submit_comment() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 42, vec!["test".to_string()])?;
    
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        cache: Mutex::new(cache),
    });

    let req = CommentRequest {
        author: "alice".to_string(),
        content: "Hello world".to_string(),
    };

    let response = submit_comment(State(state), Path(42), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let bug_path = dir.path().join("test").join("42");
    let comment_file = bug_path.join("comment_0000001");
    assert!(comment_file.exists());

    let data = fs::read(comment_file)?;
    let archived = unsafe { rkyv::archived_root::<Comment>(&data) };
    let comment: Comment = archived.deserialize(&mut rkyv::Infallible)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(comment.author, "alice");
    assert_eq!(comment.content, "Hello world");
    Ok(())
}

#[tokio::test]
async fn test_change_metadata() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 100, vec!["meta".to_string()])?;
    
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        cache: Mutex::new(cache),
    });

    let req = MetadataChangeRequest {
        field: "status".to_string(),
        value: "In Progress".to_string(),
    };

    let response = change_metadata(State(state.clone()), Path(100), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let bug_path = dir.path().join("meta").join("100");
    let data = fs::read(bug_path.join("metadata"))?;
    let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
    let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(metadata.status, "In Progress");

    // Test user metadata
    let req_user = MetadataChangeRequest {
        field: "Team".to_string(),
        value: "Perception".to_string(),
    };
    let response = change_metadata(State(state), Path(100), Json(req_user)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let data = fs::read(bug_path.join("metadata"))?;
    let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
    let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let team = metadata.user_metadata.iter().find(|m| m.key == "Team")
        .ok_or_else(|| anyhow::anyhow!("Team metadata not found"))?;
    assert_eq!(team.value, "Perception");
    Ok(())
}
