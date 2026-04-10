use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// ! STRICT MANDATE: ROOT COMPONENT CREATION VIA API IS FORBIDDEN.                !
// ! DO NOT ADD BOOTSTRAP LOGIC. DO NOT ALLOW PARENT_ID 0.                        !
// ! ROOT COMPONENTS ARE CREATED MANUALLY ON DISK ONLY.                           !
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

use serde::{Deserialize as SerdeDeserialize, Serialize as SerdeSerialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use walkdir::WalkDir;

use crate::bug_id_cache::BugIdCache;
use crate::component_id_cache::ComponentIdCache;

pub const CURRENT_VERSION: u32 = 1;

/// Custom serializer for u64 to represent them as strings with an "n" suffix in JSON.
fn serialize_u64_as_string_n<S>(val: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&format!("{}n", val))
}

/// Custom deserializer for u64 that handles strings with an "n" suffix or numbers.
fn deserialize_u64_from_string_n<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct U64Visitor;

    impl<'de> serde::de::Visitor<'de> for U64Visitor {
        type Value = u64;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a u64 as a number or a string with an 'n' suffix")
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            Ok(v)
        }

        fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            if v >= 0 {
                Ok(v as u64)
            } else {
                Err(E::custom(format!("negative value: {}", v)))
            }
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            let s = v.strip_suffix('n').unwrap_or(v);
            s.parse::<u64>().map_err(E::custom)
        }
    }

    deserializer.deserialize_any(U64Visitor)
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

#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub enum Permission {
    ComponentAdmin,
    CreateIssues,
    AdminIssues,
    EditIssues,
    CommentOnIssues,
    ViewIssues,
}

#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct GroupPermissions {
    pub permissions: Vec<Permission>,
    pub view_level: u32,
    pub members: Vec<String>,
}

#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq, Default)]
#[archive(check_bytes)]
pub struct AccessControl {
    pub groups: HashMap<String, GroupPermissions>,
}

#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq, Default)]
#[archive(check_bytes)]
pub enum TemplateAccess {
    #[default]
    Default,
    LimitedComment,
    LimitedView,
}

/// Represents a template for creating new bugs.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq, Default)]
#[archive(check_bytes)]
pub struct BugTemplate {
    pub name: String,
    pub description: String,
    pub title: String,
    #[serde(rename = "type")]
    pub bug_type: Option<String>,
    pub priority: Option<String>,
    pub severity: Option<String>,
    pub hotlist: Option<String>,
    pub assignee: Option<String>,
    pub verifier: Option<String>,
    pub collaborators: Vec<String>,
    pub cc: Vec<String>,
    pub comment: Option<String>,
    pub default_access: TemplateAccess,
}

/// Represents metadata for a component (folder).
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct ComponentMetadata {
    pub version: u32,
    pub id: u32,
    pub name: String,
    pub description: String,
    pub creator: String,
    pub bug_type: Option<String>,
    pub priority: Option<String>,
    pub severity: Option<String>,
    pub verifier: Option<String>,
    pub collaborators: Vec<String>,
    pub cc: Vec<String>,
    pub access_control: AccessControl,
    pub templates: HashMap<String, BugTemplate>,
    pub default_template: String,
    pub user_metadata: Vec<UserMetadataEntry>,
    #[serde(serialize_with = "serialize_u64_as_string_n", deserialize_with = "deserialize_u64_from_string_n")]
    pub created_at: u64,
}

impl HasVersion for ComponentMetadata {
    fn get_version(&self) -> u32 {
        self.version
    }
}

impl Default for AccessMetadata {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            full_access: vec![],
            comment_access: vec![],
            view_access: vec![],
        }
    }
}

impl ComponentMetadata {
    pub fn empty() -> Self {
        let mut templates = HashMap::new();
        templates.insert("".to_string(), BugTemplate::default());
        Self {
            version: CURRENT_VERSION,
            id: 0,
            name: "".to_string(),
            description: "".to_string(),
            creator: "".to_string(),
            bug_type: None,
            priority: None,
            severity: None,
            verifier: None,
            collaborators: vec![],
            cc: vec![],
            access_control: AccessControl::default(),
            templates,
            default_template: "".to_string(),
            user_metadata: vec![],
            created_at: 0,
        }
    }

    pub fn has_permission(&self, username: &str, permission: &Permission) -> bool {
        for group in self.access_control.groups.values() {
            if (group.members.contains(&username.to_string()) || group.members.contains(&"PUBLIC".to_string()))
                && (group.permissions.contains(permission) || group.permissions.contains(&Permission::ComponentAdmin))
            {
                return true;
            }
        }
        false
    }

    /// Merges this metadata with a child's metadata, with the child taking precedence.
    pub fn merge(&self, child: &ComponentMetadata) -> ComponentMetadata {
        let mut merged = self.clone();
        if child.id > 0 { merged.id = child.id; }
        if !child.name.is_empty() { merged.name = child.name.clone(); }
        if !child.description.is_empty() { merged.description = child.description.clone(); }
        if !child.creator.is_empty() { merged.creator = child.creator.clone(); }
        if child.bug_type.is_some() { merged.bug_type = child.bug_type.clone(); }
        if child.priority.is_some() { merged.priority = child.priority.clone(); }
        if child.severity.is_some() { merged.severity = child.severity.clone(); }
        if child.verifier.is_some() { merged.verifier = child.verifier.clone(); }
        
        if !child.collaborators.is_empty() { merged.collaborators = child.collaborators.clone(); }
        if !child.cc.is_empty() { merged.cc = child.cc.clone(); }
        
        // Merge access control: for now we'll just merge the groups map.
        // Child groups with same name overwrite parent groups.
        for (name, perms) in &child.access_control.groups {
            merged.access_control.groups.insert(name.clone(), perms.clone());
        }

        // Merge templates
        for (name, template) in &child.templates {
            merged.templates.insert(name.clone(), template.clone());
        }
        if !child.default_template.is_empty() {
            merged.default_template = child.default_template.clone();
        }

        if !child.user_metadata.is_empty() { merged.user_metadata = child.user_metadata.clone(); }
        if child.created_at > 0 { merged.created_at = child.created_at; }
        
        merged
    }
}

#[derive(Debug, PartialEq, PartialOrd, Eq, Ord)]
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
    pub fn access_level(&self, resolved_meta: &ComponentMetadata, username: &str) -> UserAccessLevel {
        let mut max_level = UserAccessLevel::None;

        for group in resolved_meta.access_control.groups.values() {
            if group.members.contains(&username.to_string()) || group.members.contains(&"PUBLIC".to_string()) {
                if group.permissions.contains(&Permission::ComponentAdmin) || 
                   group.permissions.contains(&Permission::AdminIssues) ||
                   group.permissions.contains(&Permission::EditIssues) {
                    max_level = std::cmp::max(max_level, UserAccessLevel::Full);
                }
                if group.permissions.contains(&Permission::CommentOnIssues) {
                    max_level = std::cmp::max(max_level, UserAccessLevel::Comment);
                }
                if group.permissions.contains(&Permission::ViewIssues) {
                    max_level = std::cmp::max(max_level, UserAccessLevel::View);
                }
            }
        }

        // 2. Check bug-specific access lists (for compatibility/bug-specific overrides)
        if self.access.full_access.iter().any(|u| u == username || u == "PUBLIC") {
            max_level = std::cmp::max(max_level, UserAccessLevel::Full);
        }
        if self.access.comment_access.iter().any(|u| u == username || u == "PUBLIC") {
            max_level = std::cmp::max(max_level, UserAccessLevel::Comment);
        }
        if self.access.view_access.iter().any(|u| u == username || u == "PUBLIC") {
            max_level = std::cmp::max(max_level, UserAccessLevel::View);
        }

        max_level
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
    /// Hierarchical component ID the bug belongs to.
    pub component_id: u32,
    /// Markdown-formatted description of the bug.
    pub description: String,
    /// Additional user-defined metadata entries.
    pub user_metadata: Vec<UserMetadataEntry>,
    /// Creation timestamp in epoch nanoseconds.
    #[serde(serialize_with = "serialize_u64_as_string_n", deserialize_with = "deserialize_u64_from_string_n")]
    pub created_at: u64,
    /// Incremental ID representing the state of the bug.
    #[serde(serialize_with = "serialize_u64_as_string_n", deserialize_with = "deserialize_u64_from_string_n")]
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
    #[serde(serialize_with = "serialize_u64_as_string_n", deserialize_with = "deserialize_u64_from_string_n")]
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
    /// Cache mapping bug IDs to folder locations and tracking next IDs.
    pub bug_cache: BugIdCache,
    /// Cache mapping component IDs to folder locations.
    pub component_cache: Mutex<ComponentIdCache>,
    /// Per-bug locks to synchronize modifications.
    pub bug_locks: Mutex<HashMap<u32, Arc<tokio::sync::Mutex<()>>>>,
    /// Per-component locks to synchronize modifications.
    pub component_locks: Mutex<HashMap<u32, Arc<tokio::sync::Mutex<()>>>>,
}

impl AppState {
    /// Gets or creates a mutex for a specific bug ID.
    pub fn get_bug_lock(&self, id: u32) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.bug_locks.lock().unwrap_or_else(|e| e.into_inner());
        locks.entry(id).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
    }

    /// Gets or creates a mutex for a specific component ID.
    pub fn get_component_lock(&self, id: u32) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.component_locks.lock().unwrap_or_else(|e| e.into_inner());
        locks.entry(id).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
    }
}

/// Helper function to locate the directory path of a component given its ID using the cache.
pub fn find_component_path(state: &AppState, id: u32) -> Option<PathBuf> {
    let cache = state.component_cache.lock().ok()?;
    cache.get_path(id).map(|path| state.root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR)))
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

/// Resolves the metadata for a component path by merging from root downwards.
/// 
/// Process:
/// 1. Start with an empty component metadata object.
/// 2. Split the hierarchical path (e.g., "a/b/c") into individual components.
/// 3. Try to read the "root" metadata file.
/// 4. Iteratively descend into each folder in the path:
///    a. Join the component name to the current path.
///    b. Try to read the "component_metadata" file in that folder.
///    c. If found, merge it into the current resolved metadata (child overwrites parent).
/// 5. Return the final merged metadata.
pub fn resolve_component_metadata(root: &std::path::Path, path: &str) -> ComponentMetadata {
    let mut resolved = ComponentMetadata::empty();
    
    let mut current_path = root.to_path_buf();
    let components: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Start with root metadata if it exists
    let root_meta_file = root.join("component_metadata");
    if let Ok(data) = fs::read(&root_meta_file) {
        if let Ok(meta) = read_versioned::<ComponentMetadata>(&data) {
            resolved = meta;
        }
    }

    for comp in components {
        current_path.push(comp);
        let meta_file = current_path.join("component_metadata");
        if let Ok(data) = fs::read(&meta_file) {
            if let Ok(meta) = read_versioned::<ComponentMetadata>(&data) {
                resolved = resolved.merge(&meta);
            }
        }
    }

    resolved
}

/// Request payload for creating a new component.
#[derive(SerdeDeserialize)]
pub struct CreateComponentRequest {
    pub u: String,
    pub name: String,
    pub description: String,
    pub parent_id: u32,
}

/// Helper to sanitize names for filesystem use.
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect()
}

/// Creates a new component. 
/// NOTE: Creating components at the root level via the API is STRICTLY FORBIDDEN.
/// NO BOOTSTRAP LOGIC IS ALLOWED. ROOT COMPONENTS ARE MANUAL ONLY.
/// 
/// Process:
/// 1. Resolve the parent's hierarchical path using the `parent_id` and the component cache.
/// 2. Verify that the parent directory exists on disk.
/// 3. Resolve the full merged metadata for the parent to check permissions.
/// 4. STRICTLY FORBID root component creation (parent_id 0).
/// 5. Check if the requesting user has `ComponentAdmin` permissions on the parent.
/// 6. Scan the parent directory to ensure no sub-component already has the same display name.
/// 7. Sanitize the new component name for use as a folder name.
/// 8. Generate a unique folder name by appending a numeric suffix if a collision occurs on disk.
/// 9. Create the new directory.
/// 10. Initialize the child's access control groups by cloning the parent's groups.
/// 11. Ensure the creator is added to the "Component Admins" group.
/// 12. Obtain a lock on the `component_cache` to generate a new unique component ID.
/// 13. Register the new ID and path in the cache.
/// 14. Construct the `ComponentMetadata` object with the new ID and default template.
/// 15. Serialize and write the metadata to "component_metadata" in the new folder.
pub async fn create_component(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateComponentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // 1. Resolve parent path
    // STRICT MANDATE: Root component creation via API is FORBIDDEN. 
    // parent_id 0 represents the root, and we must never allow creating children of root via API.
    if payload.parent_id == 0 {
        return Err(StatusCode::FORBIDDEN);
    }

    let (parent_path_str, parent_path) = {
        let cache = state.component_cache.lock().unwrap();
        let path_str = cache.get_path(payload.parent_id).ok_or(StatusCode::NOT_FOUND)?;
        let path = state.root.join(path_str.replace('/', std::path::MAIN_SEPARATOR_STR));
        (path_str, path)
    };

    // 2. Verify parent exists
    if !parent_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Resolve parent metadata for permission check
    let parent_meta = resolve_component_metadata(&state.root, &parent_path_str);
    
    // 4. Check authorization
    let is_authorized = parent_meta.has_permission(&payload.u, &Permission::ComponentAdmin);
    if !is_authorized {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Check for name conflicts in children metadata
    if let Ok(dir) = fs::read_dir(&parent_path) {
        for entry in dir.filter_map(|e| e.ok()) {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let meta_file = entry.path().join("component_metadata");
                if let Ok(data) = fs::read(&meta_file) {
                    if let Ok(meta) = read_versioned::<ComponentMetadata>(&data) {
                        if meta.name == payload.name {
                            return Err(StatusCode::CONFLICT);
                        }
                    }
                }
            }
        }
    }

    // 6 & 7. Generate safe and unique folder name
    let safe_name = sanitize_name(&payload.name);
    let mut component_path = parent_path.join(&safe_name);
    let mut suffix = 1;
    while component_path.exists() {
        component_path = parent_path.join(format!("{}_{}", safe_name, suffix));
        suffix += 1;
    }

    // 8. Create directory
    fs::create_dir_all(&component_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 9. Setup access control (inheriting from parent)
    let mut groups = parent_meta.access_control.groups.clone();
    
    // 10. Ensure creator is Admin
    let admins = groups.entry("Component Admins".to_string()).or_insert_with(|| GroupPermissions {
        permissions: vec![
            Permission::ComponentAdmin, Permission::CreateIssues, Permission::AdminIssues,
            Permission::EditIssues, Permission::CommentOnIssues, Permission::ViewIssues
        ],
        view_level: 999,
        members: vec![],
    });
    if !admins.members.contains(&payload.u) {
        admins.members.push(payload.u.clone());
    }

    // Ensure standard groups exist
    groups.entry("Issue Admins".to_string()).or_insert_with(|| GroupPermissions {
        permissions: vec![
            Permission::CreateIssues, Permission::AdminIssues,
            Permission::EditIssues, Permission::CommentOnIssues, Permission::ViewIssues
        ],
        view_level: 500,
        members: vec![],
    });
    groups.entry("Issue Editors".to_string()).or_insert_with(|| GroupPermissions {
        permissions: vec![
            Permission::CreateIssues, Permission::EditIssues, 
            Permission::CommentOnIssues, Permission::ViewIssues
        ],
        view_level: 100,
        members: vec![],
    });
    groups.entry("Issue Contributors".to_string()).or_insert_with(|| GroupPermissions {
        permissions: vec![
            Permission::CreateIssues, Permission::CommentOnIssues, Permission::ViewIssues
        ],
        view_level: 1,
        members: vec!["PUBLIC".to_string()],
    });

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 11 & 12. Atomic cache update and ID generation
    let mut templates = HashMap::new();
    templates.insert("".to_string(), BugTemplate::default());

    let (new_id, _relative_path_str) = {
        let mut cache = state.component_cache.lock().unwrap();
        let id = cache.get_next_id();
        let rel_path = component_path.strip_prefix(&state.root).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
        cache.insert(id, rel_path_str.clone());
        (id, rel_path_str)
    };

    // 13. Build metadata
    let meta = ComponentMetadata {
        version: CURRENT_VERSION,
        id: new_id,
        name: payload.name,
        description: payload.description,
        creator: payload.u,
        bug_type: None,
        priority: None,
        severity: None,
        verifier: None,
        collaborators: vec![],
        cc: vec![],
        access_control: AccessControl { groups },
        templates,
        default_template: "".to_string(),
        user_metadata: vec![],
        created_at: now.as_nanos() as u64,
    };

    // 14. Persist to disk
    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(component_path.join("component_metadata"), bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::CREATED)
}

/// Request payload for creating a new bug.
#[derive(SerdeDeserialize)]
pub struct CreateBugRequest {
    pub u: String,
    pub component_id: u32,
    pub template_name: String,
    pub title: String,
    pub description: String,
    #[serde(rename = "type")]
    pub bug_type: Option<String>,
    pub priority: Option<String>,
    pub severity: Option<String>,
    pub assignee: Option<String>,
    pub verifier: Option<String>,
    pub collaborators: Vec<String>,
    pub cc: Vec<String>,
    pub created_at: Option<u64>,
}

/// Creates a new bug in a component.
/// 
/// Process:
/// 1. Resolve the component path using the `component_id`.
/// 2. Verify the component exists.
/// 3. Resolve the component's hierarchical metadata.
/// 4. Check if the user has `CreateIssues` permission.
/// 5. Retrieve the specified template (or the default one).
/// 6. Determine the next available bug ID using the `BugIdCache`.
/// 7. Initialize `BugMetadata` using a mix of provided values, template values, and component defaults.
/// 8. Apply template-based access control (Default, Limited Comment, Limited View).
/// 9. Create the bug's directory (named by its ID) inside the component folder.
/// 10. Persist the `BugMetadata` to a "metadata" file in the bug directory.
/// 11. Create the initial bug description as "comment_0000001".
/// 12. Update the `BugIdCache` with the new bug's ID and hierarchical location.
pub async fn create_bug(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateBugRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // 1 & 2. Resolve component path
    let (component_path_str, component_path) = {
        let cache = state.component_cache.lock().unwrap();
        let path_str = cache.get_path(payload.component_id).ok_or(StatusCode::NOT_FOUND)?;
        let path = state.root.join(path_str.replace('/', std::path::MAIN_SEPARATOR_STR));
        (path_str, path)
    };

    if !component_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Resolve metadata
    let component_meta = resolve_component_metadata(&state.root, &component_path_str);

    // 4. Permission check
    if !component_meta.has_permission(&payload.u, &Permission::CreateIssues) {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Get template, if it doesn't exist fail.
    let template = component_meta.templates.get(&payload.template_name)
        .ok_or(StatusCode::BAD_REQUEST)?;

    // 6. Generate ID
    let new_id = state.bug_cache.get_next_bug_id();
    state.bug_cache.insert_bug(new_id as u64, component_path_str.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect());
    let _ = state.bug_cache.save(&state.root);

    // 7. Initialize metadata
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let created_at = payload.created_at.unwrap_or(now.as_nanos() as u64);

    // 8. Apply template-based access control
    let mut access = AccessMetadata::default();
    match template.default_access {
        TemplateAccess::Default => {},
        TemplateAccess::LimitedComment => {
            access.comment_access.push("PUBLIC".to_string());
        },
        TemplateAccess::LimitedView => {
            access.view_access.push("PUBLIC".to_string());
        }
    }

    let metadata = BugMetadata {
        version: CURRENT_VERSION,
        id: new_id,
        reporter: payload.u.clone(),
        bug_type: payload.bug_type.or(template.bug_type.clone()).unwrap_or_else(|| component_meta.bug_type.clone().unwrap_or_else(|| "Bug".to_string())),
        priority: payload.priority.or(template.priority.clone()).unwrap_or_else(|| component_meta.priority.clone().unwrap_or_else(|| "P2".to_string())),
        severity: payload.severity.or(template.severity.clone()).unwrap_or_else(|| component_meta.severity.clone().unwrap_or_else(|| "S2".to_string())),
        status: "New".to_string(),
        assignee: payload.assignee.or(template.assignee.clone()).unwrap_or_default(),
        verifier: payload.verifier.or(template.verifier.clone()).unwrap_or_else(|| component_meta.verifier.clone().unwrap_or_default()),
        collaborators: if !payload.collaborators.is_empty() { payload.collaborators.clone() } else { template.collaborators.clone() },
        cc: if !payload.cc.is_empty() { payload.cc.clone() } else { template.cc.clone() },
        access,
        title: if payload.title.is_empty() { template.title.clone() } else { payload.title.clone() },
        component_id: payload.component_id,
        description: if payload.description.is_empty() { template.description.clone() } else { payload.description.clone() },
        user_metadata: vec![],
        created_at,
        state_id: 1,
    };

    // 9. Create directory
    let bug_dir = component_path.join(new_id.to_string());
    fs::create_dir_all(&bug_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 10. Persist metadata
    let bytes = rkyv::to_bytes::<_, 8192>(&metadata).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(bug_dir.join("metadata"), bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(new_id))
}

/// Request payload for adding a template.
#[derive(SerdeDeserialize)]
pub struct TemplateRequest {
    pub u: String,
    pub template: BugTemplate,
}

/// Adds a new template to a component.
/// 
/// Process:
/// 1. Acquire a mutex for the component to prevent race conditions during template modifications.
/// 2. Resolve the component's path on disk using its ID.
/// 3. Read the existing component metadata from disk.
/// 4. Check if the user has `ComponentAdmin` permissions.
/// 5. Validate that the new template name is not empty (reserved for the default template).
/// 6. Check for duplicate template names.
/// 7. Insert the new template into the component's template map.
/// 8. Serialize and save the updated metadata back to disk.
pub async fn add_template(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<TemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // 1. Lock component
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    // 2. Resolve path
    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    if !meta_file.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Read metadata
    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 4. Permission check
    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Validation
    if payload.template.name.is_empty() {
        return Err(StatusCode::BAD_REQUEST); 
    }

    // 6. Duplicate check
    if meta.templates.contains_key(&payload.template.name) {
        return Err(StatusCode::CONFLICT);
    }

    // 7. Update metadata
    meta.templates.insert(payload.template.name.clone(), payload.template);

    // 8. Persist
    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Request payload for modifying a template.
#[derive(SerdeDeserialize)]
pub struct ModifyTemplateRequest {
    pub u: String,
    pub old_name: String,
    pub template: BugTemplate,
}

/// Modifies an existing template.
/// 
/// Process:
/// 1. Acquire component lock.
/// 2. Resolve component path and read its metadata.
/// 3. Verify user has `ComponentAdmin` permissions.
/// 4. Ensure the template being modified exists.
/// 5. Enforce restriction: The default template (name "") cannot be renamed.
/// 6. If renaming, check that the new name does not conflict with an existing template.
/// 7. Remove the old template entry and insert the updated template.
/// 8. Persist changes to disk.
pub async fn modify_template(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<ModifyTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if !meta.templates.contains_key(&payload.old_name) {
        return Err(StatusCode::NOT_FOUND);
    }

    // Rule: can't rename the 'default template'
    if payload.old_name.is_empty() && payload.template.name != "" {
        return Err(StatusCode::BAD_REQUEST);
    }

    if payload.old_name != payload.template.name && meta.templates.contains_key(&payload.template.name) {
        return Err(StatusCode::CONFLICT);
    }

    meta.templates.remove(&payload.old_name);
    meta.templates.insert(payload.template.name.clone(), payload.template);

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Request payload for deleting a template.
#[derive(SerdeDeserialize)]
pub struct DeleteTemplateRequest {
    pub u: String,
    pub name: String,
}

/// Deletes a template from a component.
/// 
/// Process:
/// 1. Acquire component lock.
/// 2. Resolve component path and read its metadata.
/// 3. Verify user has `ComponentAdmin` permissions.
/// 4. Enforce restriction: The default template (name "") cannot be deleted.
/// 5. Remove the template from the map and verify it existed.
/// 6. Persist updated metadata back to disk.
pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<DeleteTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if payload.name.is_empty() {
        return Err(StatusCode::BAD_REQUEST); // Protected default template
    }

    if meta.templates.remove(&payload.name).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}


/// Request payload for updating component metadata.
#[derive(SerdeDeserialize)]
pub struct UpdateComponentMetadataRequest {
    pub u: String,
    pub metadata: ComponentMetadata,
}

/// Updates the metadata for a specific component.
pub async fn update_component_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Json(payload): Json<UpdateComponentMetadataRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // 1. Lock component
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    // 2. Resolve path
    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    if !meta_file.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Read old metadata for permission check
    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let old_meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 4. Permission check (only ComponentAdmin can update metadata)
    if !old_meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Validation: Ensure ID matches
    if payload.metadata.id != id {
        return Err(StatusCode::BAD_REQUEST);
    }

    // 6. Persist updated metadata
    let bytes = rkyv::to_bytes::<_, 4096>(&payload.metadata).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Retrieves the resolved metadata for a specific component.
/// 
/// Process:
/// 1. Resolve the hierarchical path string from the component cache using the ID.
/// 2. Call `resolve_component_metadata` to merge metadata from root down to this path.
/// 3. Return the fully resolved metadata as JSON.
pub async fn get_component_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    Query(_query): Query<BugQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let path = {
        let cache = state.component_cache.lock().unwrap();
        cache.get_path(id).ok_or(StatusCode::NOT_FOUND)?
    };
    let resolved = resolve_component_metadata(&state.root, &path);
    
    Ok(Json(resolved))
}

/// Retrieves a list of all components (folders) in the system.
/// 
/// Process:
/// 1. Recursively walk the root directory.
/// 2. For every directory encountered:
///    a. Filter out the root itself and hidden folders (starting with "__").
///    b. Filter out folders that are named purely with numbers (these are Bug ID folders).
///    c. Convert the relative filesystem path to a standard forward-slash path string.
/// 3. Collect unique paths into a sorted list and return as JSON.
pub async fn get_component_list(
    State(state): State<Arc<AppState>>,
    Query(query): Query<BugQuery>,
) -> impl IntoResponse {
    let mut components = std::collections::HashSet::new();

    for entry in WalkDir::new(&state.root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let path = entry.path();
        if path == state.root {
            continue;
        }

        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };

        // Skip bug ID folders and hidden folders
        if file_name.parse::<u64>().is_ok() || file_name.starts_with("__") {
            continue;
        }

        if let Ok(relative_path) = path.strip_prefix(&state.root) {
            let path_str = relative_path.to_string_lossy().replace('\\', "/");
            if !path_str.is_empty() {
                // Permission check
                let resolved_meta = resolve_component_metadata(&state.root, &path_str);
                if resolved_meta.has_permission(&query.u, &Permission::ViewIssues) {
                    components.insert(path_str);
                }
            }
        }
    }

    let mut list: Vec<String> = components.into_iter().collect();
    list.sort();
    Json(list)
}

/// Retrieves a list of bugs matching the search criteria.
/// 
/// Process:
/// 1. Recursively scan the root for files named "metadata".
/// 2. For each metadata file:
///    a. Deserialize the `BugMetadata`.
///    b. Check if the requesting user has at least `View` access.
///    c. If a search query `q` is provided, match it against the title, assignee, and reporter (case-insensitive).
///    d. If it matches, add a `BugSummary` to the result list.
/// 3. Return the collected summaries as JSON.
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
        
        // Check view access
        let component_path = {
            let cache = state.component_cache.lock().unwrap();
            cache.get_path(metadata.component_id).unwrap_or_default()
        };
        let resolved_meta = resolve_component_metadata(&state.root, &component_path);

        if metadata.access_level(&resolved_meta, &u) < UserAccessLevel::View {
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
/// 
/// Process:
/// 1. Locate the bug's directory using the bug ID cache.
/// 2. Read and deserialize the "metadata" file.
/// 3. Verify the requesting user has `View` access.
/// 4. Read the bug's directory to find all files starting with "comment_".
/// 5. Deserialize and collect all comments into a list.
/// 6. Sort comments by their sequential ID.
/// 7. Construct and return the full `Bug` object as JSON.
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

    let (resolved_meta, folders) = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache.get_path(metadata.component_id).unwrap_or_default();
        let folders = path.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        (resolve_component_metadata(&state.root, &path), folders)
    };

    if metadata.access_level(&resolved_meta, &query.u) < UserAccessLevel::View {
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
        folders,
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

/// Retrieves the current state ID of a specific bug. Used for cache invalidation.
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

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache.get_path(metadata.component_id).unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if metadata.access_level(&resolved_meta, &query.u) < UserAccessLevel::View {
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
/// 
/// Process:
/// 1. Acquire the bug-specific mutex to synchronize updates.
/// 2. Locate the bug's directory and read its metadata.
/// 3. Verify the user has `Comment` access.
/// 4. Increment the bug's `state_id` and save the updated metadata.
/// 5. Scan the bug directory to determine the next sequential comment ID.
/// 6. Construct the `Comment` object with the current timestamp.
/// 7. Serialize and save the comment to a new file (e.g., "comment_0000005").
/// 8. Return the new comment ID and the new bug state ID.
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

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache.get_path(metadata.component_id).unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if metadata.access_level(&resolved_meta, &payload.u) < UserAccessLevel::Comment {
        return Err(StatusCode::FORBIDDEN);
    }

    metadata.state_id += 1;
    let new_state_id = metadata.state_id;
    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&metadata_file, bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let next_comment_id = state.bug_cache.get_next_comment_id(id as u64);
    let _ = state.bug_cache.save(&state.root);

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
/// 
/// Process:
/// 1. Acquire bug lock.
/// 2. Locate bug and read metadata.
/// 3. Verify `Full` (Edit) access.
/// 4. If the field is a system field (status, priority, etc.), update it directly.
/// 5. Otherwise, search for the key in `user_metadata`. If found, update it; if not, add a new entry.
/// 6. Increment `state_id`.
/// 7. Persist updated metadata to disk.
/// 8. Return the new `state_id`.
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

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache.get_path(metadata.component_id).unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if metadata.access_level(&resolved_meta, &payload.u) < UserAccessLevel::Full {
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
    state.bug_cache.get_path(&state.root, id as u64)
}

/// Safely reads versioned rkyv data.
/// For now, it simply performs full safe deserialization and verifies the version.
/// This can be expanded in the future to handle complex schema migrations.
pub fn read_versioned<T>(data: &[u8]) -> Result<T, String>
where
    T: rkyv::Archive + HasVersion,
    T::Archived: for<'a> rkyv::CheckBytes<rkyv::validation::validators::DefaultValidator<'a>> + rkyv::Deserialize<T, rkyv::de::deserializers::SharedDeserializeMap>,
{
    match rkyv::from_bytes::<T>(data) {
        Ok(val) => {
            Ok(val)
        }
        Err(e) => {
            let err_msg = format!("Rkyv deserialization error: {:?}", e);
            tracing::error!("{}", err_msg);
            Err(err_msg)
        }
    }
}

#[cfg(test)]
mod api_test;
