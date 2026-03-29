use super::*;
use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::Json;
use tempfile::tempdir;
use std::fs;
use std::sync::Arc;
use std::path::Path as StdPath;
use axum::http::StatusCode;

fn create_test_bug(root: &StdPath, id: u32, folders: Vec<String>) -> std::path::PathBuf {
    let mut bug_path = root.to_path_buf();
    for folder in &folders {
        bug_path.push(folder);
    }
    bug_path.push(id.to_string());
    fs::create_dir_all(&bug_path).unwrap();

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
        user_metadata: vec![],
        created_at: 123456789,
    };

    let bytes = rkyv::to_bytes::<_, 1024>(&metadata).unwrap();
    fs::write(bug_path.join("metadata"), bytes).unwrap();
    bug_path
}

#[tokio::test]
async fn test_create_and_get_bug() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState { root: dir.path().to_path_buf() });
    
    create_test_bug(dir.path(), 1, vec!["google".to_string(), "sxs".to_string()]);

    let response = get_bug(State(state.clone()), Path(1)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_submit_comment() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState { root: dir.path().to_path_buf() });
    
    let bug_path = create_test_bug(dir.path(), 42, vec!["test".to_string()]);

    let req = CommentRequest {
        author: "alice".to_string(),
        content: "Hello world".to_string(),
    };

    let response = submit_comment(State(state), Path(42), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::CREATED);

    let comment_file = bug_path.join("comment_0000001");
    assert!(comment_file.exists());

    let data = fs::read(comment_file).unwrap();
    let archived = unsafe { rkyv::archived_root::<Comment>(&data) };
    let comment: Comment = archived.deserialize(&mut rkyv::Infallible).unwrap();
    assert_eq!(comment.author, "alice");
    assert_eq!(comment.content, "Hello world");
}

#[tokio::test]
async fn test_change_metadata() {
    let dir = tempdir().unwrap();
    let state = Arc::new(AppState { root: dir.path().to_path_buf() });
    
    let bug_path = create_test_bug(dir.path(), 100, vec!["meta".to_string()]);

    let req = MetadataChangeRequest {
        field: "status".to_string(),
        value: "In Progress".to_string(),
    };

    let response = change_metadata(State(state.clone()), Path(100), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let data = fs::read(bug_path.join("metadata")).unwrap();
    let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
    let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible).unwrap();
    assert_eq!(metadata.status, "In Progress");

    // Test user metadata
    let req_user = MetadataChangeRequest {
        field: "Team".to_string(),
        value: "Perception".to_string(),
    };
    change_metadata(State(state), Path(100), Json(req_user)).await;

    let data = fs::read(bug_path.join("metadata")).unwrap();
    let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
    let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible).unwrap();
    let team = metadata.user_metadata.iter().find(|m| m.key == "Team").unwrap();
    assert_eq!(team.value, "Perception");
}
