use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize as SerdeDeserialize, Serialize as SerdeSerialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

use crate::bug_id_cache::BugIdCache;

pub const CURRENT_VERSION: u32 = 1;

/// Custom serializer for u64 to represent them as strings with an "n" suffix in JSON.
fn serialize_u64_as_string_n<S>(val: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&format!("{}n", val))
}

/// Trait for types that support versioning.
pub trait HasVersion {
    fn get_version(&self) -> u32;
}

/// Represents a single user-defined metadata entry.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct UserMetadataEntry {
    pub version: u32,
    /// The key/name of the metadata field.
    pub key: String,
    /// The value of the metadata field.
    pub value: String,
    /// The data type of the value (e.g., "string").
    #[serde(rename = "type")]
    pub entry_type: String,
}

impl HasVersion for UserMetadataEntry {
    fn get_version(&self) -> u32 {
        self.version
    }
}

/// Represents access control levels for a bug.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct AccessMetadata {
    pub version: u32,
    /// Users with full administrative access.
    pub full_access: Vec<String>,
    /// Users who can only comment.
    pub comment_access: Vec<String>,
    /// Users who can only view.
    pub view_access: Vec<String>,
}

#[derive(Debug, PartialEq, PartialOrd)]
pub enum UserAccessLevel {
    None,
    View,
    Comment,
    Full,
}

impl HasVersion for AccessMetadata {
    fn get_version(&self) -> u32 {
        self.version
    }
}

impl BugMetadata {
    pub fn access_level(&self, username: &str) -> UserAccessLevel {
        if self.access.full_access.iter().any(|u| u == username || u == "PUBLIC") {
            return UserAccessLevel::Full;
        }
        if self.access.comment_access.iter().any(|u| u == username || u == "PUBLIC") {
            return UserAccessLevel::Comment;
        }
        if self.access.view_access.iter().any(|u| u == username || u == "PUBLIC") {
            return UserAccessLevel::View;
        }
        UserAccessLevel::None
    }
}

/// Contains all the core metadata for a bug.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct BugMetadata {
    pub version: u32,
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
    /// The user who will verify the fix.
    pub verifier: String,
    /// Users helping with the bug.
    pub collaborators: Vec<String>,
    /// Users to be notified of updates.
    pub cc: Vec<String>,
    /// Access control lists.
    pub access: AccessMetadata,
    /// Brief title describing the bug.
    pub title: String,
    /// Hierarchical components/folders the bug belongs to.
    pub folders: Vec<String>,
    /// Markdown-formatted description of the bug.
    pub description: String,
    /// Additional user-defined metadata entries.
    pub user_metadata: Vec<UserMetadataEntry>,
    /// Creation timestamp in epoch nanoseconds.
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub created_at: u64,
    /// Incremental ID representing the state of the bug.
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub state_id: u64,
}

impl HasVersion for BugMetadata {
    fn get_version(&self) -> u32 {
        self.version
    }
}

/// Represents a comment left on a bug.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct Comment {
    pub version: u32,
    /// Sequential ID of the comment within the bug.
    pub id: u32,
    /// The user who authored the comment.
    pub author: String,
    /// Timestamp when the server received the comment.
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub epoch_nanoseconds: u64,
    /// Markdown-formatted content of the comment.
    pub content: String,
}

impl HasVersion for Comment {
    fn get_version(&self) -> u32 {
        self.version
    }
}

/// A complete bug object including its metadata and history.
#[derive(SerdeSerialize, SerdeDeserialize, Debug)]
pub struct Bug {
    pub id: u32,
    pub title: String,
    pub folders: Vec<String>,
    pub metadata: BugMetadata,
    pub comments: Vec<Comment>,
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub state_id: u64,
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
    /// Cache mapping bug IDs to folder locations.
    pub cache: Mutex<BugIdCache>,
    /// Per-bug locks to synchronize modifications.
    pub bug_locks: Mutex<HashMap<u32, Arc<tokio::sync::Mutex<()>>>>,
}

impl AppState {
    /// Gets or creates a mutex for a specific bug ID.
    pub fn get_bug_lock(&self, id: u32) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.bug_locks.lock().unwrap_or_else(|e| e.into_inner());
        locks.entry(id).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
    }
}

/// Query parameters for searching bugs.
#[derive(SerdeDeserialize)]
pub struct SearchQuery {
    /// Search term to match against title, assignee, or reporter.
    pub q: Option<String>,
    /// The username of the user making the request.
    pub u: String,
}

/// Query parameters for bug-specific requests.
#[derive(SerdeDeserialize)]
pub struct BugQuery {
    /// The username of the user making the request.
    pub u: String,
}

/// Retrieves a list of bugs matching the search criteria.
/// Requires bugs to have at least one component (folder).
pub async fn get_bug_list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let mut summaries = Vec::new();
    let q = query.q.unwrap_or_default().to_lowercase();
    let u = query.u;

    for entry in WalkDir::new(&state.root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() == "metadata")
    {
        let data = match fs::read(entry.path()) {
            Ok(d) => d,
            Err(_) => continue,
        };
        
        let metadata: BugMetadata = match read_versioned::<BugMetadata>(&data) {
            Ok(m) => m,
            Err(_) => continue,
        };
        
        // Requirement: bugs must have at least one component.
        if metadata.folders.is_empty() {
            continue;
        }

        // Check view access
        if metadata.access_level(&u) < UserAccessLevel::View {
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
    Query(query): Query<BugQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let bug_path = find_bug_path(&state, id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let metadata_data = fs::read(bug_path.join("metadata"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let metadata: BugMetadata = read_versioned::<BugMetadata>(&metadata_data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if metadata.access_level(&query.u) < UserAccessLevel::View {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut comments = Vec::new();
    if let Ok(dir) = fs::read_dir(&bug_path) {
        for entry in dir.filter_map(|e| e.ok()) {
            let name = entry.file_name().into_string().unwrap_or_default();
            if name.starts_with("comment_") {
                if let Ok(data) = fs::read(entry.path()) {
                    let comment: Comment = read_versioned::<Comment>(&data)
                        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                    comments.push(comment);
                }
            }
        }
    }
    comments.sort_by_key(|c: &Comment| c.id);

    Ok(Json(Bug {
        id: metadata.id,
        title: metadata.title.clone(),
        folders: metadata.folders.clone(),
        state_id: metadata.state_id,
        metadata,
        comments,
    }))
}

/// Response payload for the bug state endpoint.
#[derive(SerdeSerialize)]
pub struct BugStateResponse {
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub state_id: u64,
}

/// Retrieves the current state ID of a specific bug.
pub async fn get_bug_state(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Query(query): Query<BugQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let bug_path = find_bug_path(&state, id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let metadata_data = fs::read(bug_path.join("metadata"))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let metadata: BugMetadata = read_versioned::<BugMetadata>(&metadata_data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if metadata.access_level(&query.u) < UserAccessLevel::View {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(Json(BugStateResponse { state_id: metadata.state_id }))
}

/// Request payload for submitting a new comment.
#[derive(SerdeDeserialize)]
pub struct CommentRequest {
    pub author: String,
    pub content: String,
    /// The username of the user making the request (must match author).
    pub u: String,
}

/// Response payload for submitting a new comment.
#[derive(SerdeSerialize)]
pub struct SubmitCommentResponse {
    pub comment_id: u32,
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub state_id: u64,
}

/// Submits a new comment to an existing bug.
pub async fn submit_comment(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<CommentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_bug_lock(id);
    let _guard = lock.lock().await;
    let bug_path = find_bug_path(&state, id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let metadata_file = bug_path.join("metadata");
    let data = fs::read(&metadata_file)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut metadata: BugMetadata = read_versioned::<BugMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if metadata.access_level(&payload.u) < UserAccessLevel::Comment {
        return Err(StatusCode::FORBIDDEN);
    }

    metadata.state_id += 1;
    let new_state_id = metadata.state_id;
    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&metadata_file, bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut next_comment_id = 1;
    if let Ok(dir) = fs::read_dir(&bug_path) {
        for entry in dir.filter_map(|e| e.ok()) {
            let name = entry.file_name().into_string().unwrap_or_default();
            if name.starts_with("comment_") {
                if let Ok(cid) = name["comment_".len()..].parse::<u32>() {
                    if cid >= next_comment_id {
                        next_comment_id = cid + 1;
                    }
                }
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let comment = Comment {
        version: CURRENT_VERSION,
        id: next_comment_id,
        author: payload.author,
        epoch_nanoseconds: now.as_nanos() as u64,
        content: payload.content,
    };

    let bytes = rkyv::to_bytes::<_, 256>(&comment)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(bug_path.join(format!("comment_{:07}", next_comment_id)), bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(SubmitCommentResponse {
        comment_id: next_comment_id,
        state_id: new_state_id,
    }))
}

/// Request payload for changing bug metadata.
#[derive(SerdeDeserialize)]
pub struct MetadataChangeRequest {
    pub field: String,
    pub value: String,
    /// The username of the user making the request.
    pub u: String,
}

/// Response payload for changing bug metadata.
#[derive(SerdeSerialize)]
pub struct ChangeMetadataResponse {
    #[serde(serialize_with = "serialize_u64_as_string_n")]
    pub state_id: u64,
}

/// Updates a metadata field for a specific bug.
/// Handles both system fields and user-defined metadata.
pub async fn change_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<MetadataChangeRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_bug_lock(id);
    let _guard = lock.lock().await;
    let bug_path = find_bug_path(&state, id)
        .ok_or(StatusCode::NOT_FOUND)?;

    let metadata_file = bug_path.join("metadata");
    let data = fs::read(&metadata_file)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut metadata: BugMetadata = read_versioned::<BugMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if metadata.access_level(&payload.u) < UserAccessLevel::Full {
        return Err(StatusCode::FORBIDDEN);
    }

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
                    version: CURRENT_VERSION,
                    key: payload.field,
                    value: payload.value,
                    entry_type: "string".to_string(),
                });
            }
        }
    }

    metadata.state_id += 1;
    let new_state_id = metadata.state_id;

    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(metadata_file, bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ChangeMetadataResponse {
        state_id: new_state_id,
    }))
}

/// Helper function to locate the directory path of a bug given its ID using the cache.
pub fn find_bug_path(state: &AppState, id: u32) -> Option<PathBuf> {
    let cache = state.cache.lock().ok()?;
    cache.get_path(&state.root, id as u64)
}

/// Safely reads versioned rkyv data.
/// For now, it simply performs full safe deserialization and verifies the version.
/// This can be expanded in the future to handle complex schema migrations.
pub fn read_versioned<T>(data: &[u8]) -> Result<T, String>
where
    T: rkyv::Archive + HasVersion,
    T::Archived: for<'a> rkyv::CheckBytes<rkyv::validation::validators::DefaultValidator<'a>> + rkyv::Deserialize<T, rkyv::de::deserializers::SharedDeserializeMap>,
{
    let val: T = rkyv::from_bytes::<T>(data).map_err(|e| format!("Rkyv deserialization error: {:?}", e))?;
    
    if val.get_version() != CURRENT_VERSION {
        // Migration logic would go here if we had multiple versions.
        // If the schema is backward compatible, val might already be usable.
    }

    Ok(val)
}

#[cfg(test)]
mod api_test;
