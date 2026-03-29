use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rkyv::{Archive, Deserialize, Serialize};
use serde::{Deserialize as SerdeDeserialize, Serialize as SerdeSerialize};
use std::fs;
use std::path::{Path as StdPath, PathBuf};
use std::sync::Arc;
use walkdir::WalkDir;

/// Represents a single user-defined metadata entry.
#[derive(Archive, Deserialize, Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
pub struct UserMetadataEntry {
    /// The key/name of the metadata field.
    pub key: String,
    /// The value of the metadata field.
    pub value: String,
    /// The data type of the value (e.g., "string").
    #[serde(rename = "type")]
    pub entry_type: String,
}

/// Contains all the core metadata for a bug.
#[derive(Archive, Deserialize, Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
pub struct BugMetadata {
    /// Unique numeric ID of the bug.
    pub id: u32,
    /// The user who reported the bug.
    pub reporter: String,
    /// The category of the bug (e.g., "Bug", "Feature").
    #[serde(rename = "type")]
    pub bug_type: String,
    /// Priority level (e.g., "P1", "P2").
    pub priority: String,
    /// Severity level (e.g., "S1", "S2").
    pub severity: String,
    /// Current status of the bug.
    pub status: String,
    /// The user currently assigned to the bug.
    pub assignee: String,
    /// Brief title describing the bug.
    pub title: String,
    /// Hierarchical components/folders the bug belongs to.
    pub folders: Vec<String>,
    /// Additional user-defined metadata entries.
    pub user_metadata: Vec<UserMetadataEntry>,
    /// Creation timestamp in epoch nanoseconds.
    pub created_at: u64,
}

/// Represents a comment left on a bug.
#[derive(Archive, Deserialize, Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
pub struct Comment {
    /// Sequential ID of the comment within the bug.
    pub id: u32,
    /// The user who authored the comment.
    pub author: String,
    /// Timestamp when the server received the comment.
    pub epoch_nanoseconds: u64,
    /// Markdown-formatted content of the comment.
    pub content: String,
}

/// A complete bug object including its metadata and history.
#[derive(SerdeSerialize, SerdeDeserialize, Debug)]
pub struct Bug {
    pub id: u32,
    pub title: String,
    pub folders: Vec<String>,
    pub metadata: BugMetadata,
    pub comments: Vec<Comment>,
}

/// A brief summary of a bug for list views.
#[derive(SerdeSerialize, SerdeDeserialize, Debug, PartialEq)]
pub struct BugSummary {
    pub id: u32,
    pub title: String,
}

/// Shared application state.
pub struct AppState {
    /// The root directory where bug data is stored.
    pub root: PathBuf,
}

/// Query parameters for searching bugs.
#[derive(SerdeDeserialize)]
pub struct SearchQuery {
    /// Search term to match against title, assignee, or reporter.
    pub q: Option<String>,
}

/// Retrieves a list of bugs matching the search criteria.
/// Requires bugs to have at least one component (folder).
pub async fn get_bug_list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let mut summaries = Vec::new();
    let q = query.q.unwrap_or_default().to_lowercase();

    for entry in WalkDir::new(&state.root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() == "metadata")
    {
        let data = match fs::read(entry.path()) {
            Ok(d) => d,
            Err(_) => continue,
        };
        
        let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
        let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible).unwrap();
        
        // Requirement: bugs must have at least one component.
        if metadata.folders.is_empty() {
            continue;
        }

        let matches = q.is_empty() 
            || metadata.title.to_lowercase().contains(&q)
            || metadata.assignee.to_lowercase().contains(&q)
            || metadata.reporter.to_lowercase().contains(&q);

        if matches {
            summaries.push(BugSummary {
                id: metadata.id,
                title: metadata.title.clone(),
            });
        }
    }

    Json(summaries)
}

/// Retrieves the full details of a specific bug by its ID.
pub async fn get_bug(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
) -> impl IntoResponse {
    let bug_path = match find_bug_path(&state.root, id) {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Bug not found").into_response(),
    };

    let metadata_data = fs::read(bug_path.join("metadata")).unwrap();
    let archived_metadata = unsafe { rkyv::archived_root::<BugMetadata>(&metadata_data) };
    let metadata: BugMetadata = archived_metadata.deserialize(&mut rkyv::Infallible).unwrap();

    let mut comments = Vec::new();
    for entry in fs::read_dir(&bug_path).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().into_string().unwrap();
        if name.starts_with("comment_") {
            let data = fs::read(entry.path()).unwrap();
            let archived_comment = unsafe { rkyv::archived_root::<Comment>(&data) };
            let comment: Comment = archived_comment.deserialize(&mut rkyv::Infallible).unwrap();
            comments.push(comment);
        }
    }
    comments.sort_by_key(|c| c.id);

    Json(Bug {
        id: metadata.id,
        title: metadata.title.clone(),
        folders: metadata.folders.clone(),
        metadata,
        comments,
    })
    .into_response()
}

/// Request payload for submitting a new comment.
#[derive(SerdeDeserialize)]
pub struct CommentRequest {
    pub author: String,
    pub content: String,
}

/// Submits a new comment to an existing bug.
pub async fn submit_comment(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<CommentRequest>,
) -> impl IntoResponse {
    let bug_path = match find_bug_path(&state.root, id) {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Bug not found").into_response(),
    };

    let mut next_comment_id = 1;
    for entry in fs::read_dir(&bug_path).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().into_string().unwrap();
        if name.starts_with("comment_") {
            if let Ok(cid) = name["comment_".len()..].parse::<u32>() {
                if cid >= next_comment_id {
                    next_comment_id = cid + 1;
                }
            }
        }
    }

    let comment = Comment {
        id: next_comment_id,
        author: payload.author,
        epoch_nanoseconds: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64,
        content: payload.content,
    };

    let bytes = rkyv::to_bytes::<_, 256>(&comment).unwrap();
    fs::write(bug_path.join(format!("comment_{:07}", next_comment_id)), bytes).unwrap();

    StatusCode::CREATED.into_response()
}

/// Request payload for changing bug metadata.
#[derive(SerdeDeserialize)]
pub struct MetadataChangeRequest {
    pub field: String,
    pub value: String,
}

/// Updates a metadata field for a specific bug.
/// Handles both system fields and user-defined metadata.
pub async fn change_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<MetadataChangeRequest>,
) -> impl IntoResponse {
    let bug_path = match find_bug_path(&state.root, id) {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Bug not found").into_response(),
    };

    let metadata_file = bug_path.join("metadata");
    let data = fs::read(&metadata_file).unwrap();
    let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
    let mut metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible).unwrap();

    match payload.field.as_str() {
        "status" => metadata.status = payload.value,
        "priority" => metadata.priority = payload.value,
        "severity" => metadata.severity = payload.value,
        "assignee" => metadata.assignee = payload.value,
        "type" => metadata.bug_type = payload.value,
        _ => {
            if let Some(entry) = metadata.user_metadata.iter_mut().find(|m| m.key == payload.field) {
                entry.value = payload.value;
            } else {
                metadata.user_metadata.push(UserMetadataEntry {
                    key: payload.field,
                    value: payload.value,
                    entry_type: "string".to_string(),
                });
            }
        }
    }

    let bytes = rkyv::to_bytes::<_, 1024>(&metadata).unwrap();
    fs::write(metadata_file, bytes).unwrap();

    StatusCode::OK.into_response()
}

/// Helper function to locate the directory path of a bug given its ID.
pub fn find_bug_path(root: &StdPath, id: u32) -> Option<PathBuf> {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() == "metadata")
    {
        let data = fs::read(entry.path()).ok()?;
        let archived = unsafe { rkyv::archived_root::<BugMetadata>(&data) };
        let metadata: BugMetadata = archived.deserialize(&mut rkyv::Infallible).unwrap();
        if metadata.id == id {
            return entry.path().parent().map(|p| p.to_path_buf());
        }
    }
    None
}

#[cfg(test)]
mod api_test;
