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

/// Represents a template for creating new bugs.
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq, Default)]
#[archive(check_bytes)]
pub struct BugTemplate {
    pub name: String,
    pub description: String,
    pub title: Option<String>,
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
}

/// Represents metadata for a component (folder).
#[derive(rkyv::Archive, rkyv::Deserialize, rkyv::Serialize, SerdeSerialize, SerdeDeserialize, Clone, Debug, PartialEq)]
#[archive(check_bytes)]
pub struct ComponentMetadata {
    pub version: u32,
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
    #[serde(serialize_with = "serialize_u64_as_string_n")]
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
    pub fn access_level(&self, root: &std::path::Path, username: &str) -> UserAccessLevel {
        // 1. Check hierarchical component permissions
        let path_str = self.folders.join("/");
        let resolved_meta = resolve_component_metadata(root, &path_str);
        
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

/// Query parameters for component metadata requests.
#[derive(SerdeDeserialize)]
pub struct ComponentQuery {
    /// The hierarchical path of the component (e.g., "google/sxs").
    pub path: String,
    /// The username of the user making the request.
    pub u: String,
}

/// Resolves the metadata for a component path by merging from root downwards.
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
    pub parent: String, // Path like "google/perception" or "" for root
}

/// Helper to sanitize names for filesystem use.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect()
}

/// Creates a new component. 
/// NOTE: Creating components at the root level via the API is strictly banned and not a valid call.
/// All components must be created under an existing parent component.
pub async fn create_component(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateComponentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // CRITICAL: Creating a component at the root level via the API is explicitly banned.
    // This is a hard restriction to ensure hierarchical integrity.
    if payload.parent.is_empty() {
        return Err(StatusCode::FORBIDDEN);
    }

    let parent_path = state.root.join(payload.parent.replace('/', std::path::MAIN_SEPARATOR_STR));

    if !parent_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // Check permissions on parent
    let parent_meta = resolve_component_metadata(&state.root, &payload.parent);
    let is_authorized = parent_meta.has_permission(&payload.u, &Permission::ComponentAdmin);

    if !is_authorized {
        return Err(StatusCode::FORBIDDEN);
    }

    // Check if component with same name already exists in metadata of children
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

    let safe_name = sanitize_name(&payload.name);
    let mut component_path = parent_path.join(&safe_name);
    
    // If safe_name conflicts with existing folder, append a suffix
    let mut suffix = 1;
    while component_path.exists() {
        component_path = parent_path.join(format!("{}_{}", safe_name, suffix));
        suffix += 1;
    }

    fs::create_dir_all(&component_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut groups = parent_meta.access_control.groups.clone();
    
    // Ensure creator is in "Component Admins"
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

    // Ensure other defaults exist
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

    let mut templates = HashMap::new();
    templates.insert("".to_string(), BugTemplate::default());

    let meta = ComponentMetadata {
        version: CURRENT_VERSION,
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

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(component_path.join("component_metadata"), bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::CREATED)
}

/// Request payload for adding or modifying a template.
#[derive(SerdeDeserialize)]
pub struct TemplateRequest {
    pub u: String,
    pub path: String,
    pub template: BugTemplate,
}

/// Adds a new template to a component.
pub async fn add_template(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<TemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let component_path = state.root.join(payload.path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let meta_file = component_path.join("component_metadata");

    if !meta_file.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if payload.template.name.is_empty() {
        return Err(StatusCode::BAD_REQUEST); // Cannot add another "default" template this way
    }

    if meta.templates.contains_key(&payload.template.name) {
        return Err(StatusCode::CONFLICT);
    }

    meta.templates.insert(payload.template.name.clone(), payload.template);

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Request payload for modifying a template.
#[derive(SerdeDeserialize)]
pub struct ModifyTemplateRequest {
    pub u: String,
    pub path: String,
    pub old_name: String,
    pub template: BugTemplate,
}

/// Modifies an existing template.
pub async fn modify_template(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ModifyTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let component_path = state.root.join(payload.path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let meta_file = component_path.join("component_metadata");

    if !meta_file.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if !meta.templates.contains_key(&payload.old_name) {
        return Err(StatusCode::NOT_FOUND);
    }

    // "can't rename the 'default template'"
    if payload.old_name.is_empty() && payload.template.name != "" {
        return Err(StatusCode::BAD_REQUEST);
    }

    // If renaming, check for conflict
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
    pub path: String,
    pub name: String,
}

/// Deletes a template from a component.
pub async fn delete_template(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let component_path = state.root.join(payload.path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let meta_file = component_path.join("component_metadata");

    if !meta_file.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !meta.has_permission(&payload.u, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if payload.name.is_empty() {
        return Err(StatusCode::BAD_REQUEST); // "can't delete the 'default template'"
    }

    if meta.templates.remove(&payload.name).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}


/// Retrieves the resolved metadata for a specific component.
pub async fn get_component_metadata(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ComponentQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved = resolve_component_metadata(&state.root, &query.path);
    
    // Check view access, components are always visible to everyone.
    Ok(Json(resolved))
}

/// Retrieves a list of all components (folders) in the system.
pub async fn get_component_list(
    State(state): State<Arc<AppState>>,
    Query(_query): Query<BugQuery>,
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
                components.insert(path_str);
            }
        }
    }

    let mut list: Vec<String> = components.into_iter().collect();
    list.sort();
    Json(list)
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
        if metadata.access_level(&state.root, &u) < UserAccessLevel::View {
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

    if metadata.access_level(&state.root, &query.u) < UserAccessLevel::View {
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

    if metadata.access_level(&state.root, &query.u) < UserAccessLevel::View {
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

    if metadata.access_level(&state.root, &payload.u) < UserAccessLevel::Comment {
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

    if metadata.access_level(&state.root, &payload.u) < UserAccessLevel::Full {
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
