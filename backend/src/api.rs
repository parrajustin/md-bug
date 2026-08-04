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
use crate::search_string::SearchString;

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
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
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
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
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

#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
#[archive(check_bytes)]
pub enum Permission {
    ComponentAdmin,
    CreateIssues,
    AdminIssues,
    EditIssues,
    CommentOnIssues,
    ViewIssues,
}

#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
#[archive(check_bytes)]
pub struct GroupPermissions {
    pub permissions: Vec<Permission>,
    pub view_level: u32,
    pub members: Vec<String>,
}

#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
    Default,
)]
#[archive(check_bytes)]
pub struct AccessControl {
    pub groups: HashMap<String, GroupPermissions>,
}

#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
    Default,
)]
#[archive(check_bytes)]
pub enum TemplateAccess {
    #[default]
    Default,
    LimitedComment,
    LimitedView,
}

/// Represents a template for creating new bugs.
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
    Default,
)]
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
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
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
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
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

/// Whether `PUBLIC` should count as a match for this identity.
///
/// Bots are excluded from the wildcard: `PUBLIC` means "every person", and a bot is
/// automation that must be granted access deliberately. Otherwise any leaked token would
/// inherit read access to every component with a PUBLIC contributor group, which is the
/// opposite of the least-privilege the cap is meant to provide.
fn public_applies_to(username: &str) -> bool {
    !crate::auth::is_bot_identity(username)
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
            if (group.members.contains(&username.to_string())
                || (public_applies_to(username)
                    && group.members.contains(&"PUBLIC".to_string())))
                && (group.permissions.contains(permission)
                    || group.permissions.contains(&Permission::ComponentAdmin))
            {
                return true;
            }
        }
        false
    }

    /// Merges this metadata with a child's metadata, with the child taking precedence.
    pub fn merge(&self, child: &ComponentMetadata) -> ComponentMetadata {
        let mut merged = self.clone();
        if child.id > 0 {
            merged.id = child.id;
        }
        if !child.name.is_empty() {
            merged.name = child.name.clone();
        }
        if !child.description.is_empty() {
            merged.description = child.description.clone();
        }
        if !child.creator.is_empty() {
            merged.creator = child.creator.clone();
        }
        if child.bug_type.is_some() {
            merged.bug_type = child.bug_type.clone();
        }
        if child.priority.is_some() {
            merged.priority = child.priority.clone();
        }
        if child.severity.is_some() {
            merged.severity = child.severity.clone();
        }
        if child.verifier.is_some() {
            merged.verifier = child.verifier.clone();
        }

        if !child.collaborators.is_empty() {
            merged.collaborators = child.collaborators.clone();
        }
        if !child.cc.is_empty() {
            merged.cc = child.cc.clone();
        }

        // Merge access control: for now we'll just merge the groups map.
        // Child groups with same name overwrite parent groups.
        for (name, perms) in &child.access_control.groups {
            merged
                .access_control
                .groups
                .insert(name.clone(), perms.clone());
        }

        // Merge templates
        for (name, template) in &child.templates {
            merged.templates.insert(name.clone(), template.clone());
        }
        if !child.default_template.is_empty() {
            merged.default_template = child.default_template.clone();
        }

        if !child.user_metadata.is_empty() {
            merged.user_metadata = child.user_metadata.clone();
        }
        if child.created_at > 0 {
            merged.created_at = child.created_at;
        }

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
    pub fn access_level(
        &self,
        resolved_meta: &ComponentMetadata,
        username: &str,
    ) -> UserAccessLevel {
        // 1. Check sovereign admins (AdminIssues or EditIssues)
        // Note: ComponentAdmin is for component management and doesn't grant bug access.
        // Note: Reporter doesn't have implicit access (they are added to full_access on creation).
        for group in resolved_meta.access_control.groups.values() {
            if group.members.contains(&username.to_string())
                || (public_applies_to(username)
                    && group.members.contains(&"PUBLIC".to_string()))
            {
                if group.permissions.contains(&Permission::AdminIssues)
                    || group.permissions.contains(&Permission::EditIssues)
                {
                    return UserAccessLevel::Full;
                }
            }
        }

        let mut max_level = UserAccessLevel::None;
        // INHERIT from component (non-sovereign permissions)
        for group in resolved_meta.access_control.groups.values() {
            if group.members.contains(&username.to_string())
                || (public_applies_to(username)
                    && group.members.contains(&"PUBLIC".to_string()))
            {
                // EditIssues moved to sovereign section above
                if group.permissions.contains(&Permission::CommentOnIssues) {
                    max_level = std::cmp::max(max_level, UserAccessLevel::Comment);
                }
                if group.permissions.contains(&Permission::ViewIssues) {
                    max_level = std::cmp::max(max_level, UserAccessLevel::View);
                }
            }
        }

        // Check bug specific access.
        if self
            .access
            .full_access
            .iter()
            .any(|u| u == username || (public_applies_to(username) && u == "PUBLIC"))
        {
            max_level = std::cmp::max(max_level, UserAccessLevel::Full);
        }
        if self
            .access
            .comment_access
            .iter()
            .any(|u| u == username || (public_applies_to(username) && u == "PUBLIC"))
        {
            max_level = std::cmp::max(max_level, UserAccessLevel::Comment);
        }
        if self
            .access
            .view_access
            .iter()
            .any(|u| u == username || (public_applies_to(username) && u == "PUBLIC"))
        {
            max_level = std::cmp::max(max_level, UserAccessLevel::View);
        }

        // Collaborators and CC always give at least View access
        if self.collaborators.iter().any(|u| u == username) {
            max_level = std::cmp::max(max_level, UserAccessLevel::View);
        }
        if self.cc.iter().any(|u| u == username) {
            max_level = std::cmp::max(max_level, UserAccessLevel::View);
        }

        max_level
    }
}

/// Contains all the core metadata for a bug.
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
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
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
    pub created_at: u64,
    /// Incremental ID representing the state of the bug.
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
    pub state_id: u64,
}

impl HasVersion for BugMetadata {
    fn get_version(&self) -> u32 {
        self.version
    }
}

/// Represents a comment left on a bug.
#[derive(
    rkyv::Archive,
    rkyv::Deserialize,
    rkyv::Serialize,
    SerdeSerialize,
    SerdeDeserialize,
    Clone,
    Debug,
    PartialEq,
)]
#[archive(check_bytes)]
pub struct Comment {
    pub version: u32,
    /// Sequential ID of the comment within the bug.
    pub id: u32,
    /// The user who authored the comment.
    pub author: String,
    /// Timestamp when the server received the comment.
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
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
    pub folder_ids: Vec<u32>,
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
    pub description: String,
    pub status: String,
    pub priority: String,
    pub severity: String,
    #[serde(rename = "type")]
    pub bug_type: String,
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
    pub created_at: u64,
    #[serde(
        serialize_with = "serialize_u64_as_string_n",
        deserialize_with = "deserialize_u64_from_string_n"
    )]
    pub last_updated_at: u64,
}

/// A brief summary of a component.
#[derive(SerdeSerialize, SerdeDeserialize, Debug, Clone, PartialEq)]
pub struct ComponentSummary {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub folders: Vec<String>,
    pub parent_id: u32,
    /// Who created it. Ownership is deliberately `creator`, not "is a Component Admin":
    /// admin rights are inherited down the tree and `PUBLIC` matches everyone, so an
    /// admin check would report whole subtrees rather than what you actually made.
    #[serde(default)]
    pub creator: String,
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
    /// Accounts and tokens. Every request outside `/api/auth/*` is authenticated
    /// against this before a handler runs.
    pub users: Arc<crate::user::UserManager>,
}

impl AppState {
    /// Gets or creates a mutex for a specific bug ID.
    pub fn get_bug_lock(&self, id: u32) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.bug_locks.lock().unwrap_or_else(|e| e.into_inner());
        locks
            .entry(id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Gets or creates a mutex for a specific component ID.
    pub fn get_component_lock(&self, id: u32) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .component_locks
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        locks
            .entry(id)
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}

/// Helper function to locate the directory path of a component given its ID using the cache.
pub fn find_component_path(state: &AppState, id: u32) -> Option<PathBuf> {
    let cache = state.component_cache.lock().ok()?;
    cache.get_path(id).map(|path| {
        state
            .root
            .join(path.replace('/', std::path::MAIN_SEPARATOR_STR))
    })
}

/// Query parameters for searching bugs.
///
/// Note there is no username field: identity comes from the bearer token via the
/// [`RequestUser`] extractor. A client-supplied username would be trivially spoofable.
#[derive(SerdeDeserialize)]
pub struct SearchQuery {
    /// Search term to match against title, assignee, or reporter.
    pub q: Option<String>,
}

/// Query parameters for bug-specific requests.
#[derive(SerdeDeserialize)]
pub struct BugQuery {}

/// The authenticated caller.
///
/// Implemented as an Axum extractor so that adding it to a handler's signature is what
/// enforces authentication — a handler that forgets it will not compile against a route
/// that needs identity, and a handler that has it cannot run unauthenticated.
///
/// Rejections are deliberately coarse (`401` for anything wrong with the token) so the
/// endpoint cannot be used to distinguish "no such token" from "expired" from "wrong
/// secret".
pub struct RequestUser(pub crate::auth::RequestUser);

impl RequestUser {
    /// Builds an identity directly, bypassing token verification.
    ///
    /// This exists for two callers that have no HTTP request to extract from: the unit
    /// tests, and `md-bug-cli --root`, which invokes handlers in-process against a local
    /// data directory. Neither is a privilege escalation — anyone who can run the local
    /// CLI already has read/write access to the files the ACLs protect.
    ///
    /// It must never be reachable from a request path. Over HTTP the only way to obtain
    /// a `RequestUser` is `from_request_parts`, which requires a valid bearer token.
    pub fn local(username: impl Into<String>, uid: u64, is_admin: bool) -> Self {
        let username = username.into();
        RequestUser(crate::auth::RequestUser {
            owner_username: username.clone(),
            username,
            uid,
            is_admin,
            via_personal_token: false,
        })
    }

    /// Builds a bot identity acting under `owner`. Tests and local tooling only.
    pub fn local_bot(identity: impl Into<String>, owner: impl Into<String>, uid: u64) -> Self {
        RequestUser(crate::auth::RequestUser {
            username: identity.into(),
            owner_username: owner.into(),
            uid,
            // A bot is never an admin, whatever its owner is: admin rights create
            // accounts and mint tokens, which is not something a leaked bot key should
            // be able to do.
            is_admin: false,
            via_personal_token: true,
        })
    }

    /// Component permission check, capped at the owner's rights.
    ///
    /// **Use this rather than `ComponentMetadata::has_permission` in handlers.** For a
    /// real user the two are identical. For a bot, the permission must be granted to the
    /// bot's identity *and* still held by the account that created it — so a bot can be
    /// given less than its owner but never more, and silently loses access the moment its
    /// owner does.
    pub fn can(&self, meta: &ComponentMetadata, permission: &Permission) -> bool {
        if !meta.has_permission(&self.username, permission) {
            return false;
        }
        if self.is_bot() {
            return meta.has_permission(&self.owner_username, permission);
        }
        true
    }

    /// Bug access level, capped at the owner's level for bots.
    ///
    /// **Use this rather than `BugMetadata::access_level` in handlers.**
    pub fn bug_access(
        &self,
        bug: &BugMetadata,
        resolved: &ComponentMetadata,
    ) -> UserAccessLevel {
        let own = bug.access_level(resolved, &self.username);
        if self.is_bot() {
            return own.min(bug.access_level(resolved, &self.owner_username));
        }
        own
    }
}

impl std::ops::Deref for RequestUser {
    type Target = crate::auth::RequestUser;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[axum::async_trait]
impl axum::extract::FromRequestParts<Arc<AppState>> for RequestUser {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok());

        let presented = crate::auth::bearer_from_header(header)
            .ok_or((StatusCode::UNAUTHORIZED, "Missing bearer token"))?;

        // Access tokens are the common case; personal access tokens act as their owner
        // so agents and CLIs can call the API without an interactive login.
        let stored = match state
            .users
            .verify_token(&presented, crate::auth::TokenKind::Access)
            .await
        {
            Some(stored) => stored,
            None => state
                .users
                .verify_token(&presented, crate::auth::TokenKind::Personal)
                .await
                .ok_or((StatusCode::UNAUTHORIZED, "Invalid or expired token"))?,
        };

        let via_personal_token = stored.kind == crate::auth::TokenKind::Personal;

        // A personal token acts as its own `bot:` identity when it has one. Tokens
        // issued before identities existed fall back to acting as their owner.
        let acting_identity = stored
            .identity
            .clone()
            .unwrap_or_else(|| stored.username.clone());

        // Re-read the account rather than trusting the token: admin status and the
        // force-rotate flag can change after a token is issued.
        let user = state
            .users
            .get_user(crate::user::UserIdentifier::Username(stored.username.clone()))
            .await
            .ok_or((StatusCode::UNAUTHORIZED, "Account no longer exists"))?;

        // A user under forced password rotation is locked out of everything except the
        // change-password and logout endpoints, which do not use this extractor.
        if user.must_change_password {
            return Err((StatusCode::FORBIDDEN, "Password change required"));
        }

        let is_bot = via_personal_token && acting_identity != user.username;

        Ok(RequestUser(crate::auth::RequestUser {
            username: acting_identity,
            owner_username: user.username,
            uid: user.uid,
            // Bots are never admins regardless of their owner: admin rights create
            // accounts and mint tokens, which a leaked bot key must not be able to do.
            is_admin: user.is_admin && !is_bot,
            via_personal_token,
        }))
    }
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
    pub name: String,
    pub description: String,
    pub parent_id: u32,
}

/// Helper to sanitize names for filesystem use.
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// Builds the default permission groups for a brand-new root component.
///
/// A root has no parent to inherit from, so unlike `create_component` — which clones the
/// parent's groups — the whole ACL has to be synthesised. `admin_user_id` becomes the
/// sole Component Admin; `PUBLIC` gets contributor rights so the component is usable by
/// everyone else out of the box.
pub fn default_root_groups(admin_user_id: &str) -> HashMap<String, GroupPermissions> {
    let mut groups = HashMap::new();
    groups.insert(
        "Component Admins".to_string(),
        GroupPermissions {
            permissions: vec![
                Permission::ComponentAdmin,
                Permission::CreateIssues,
                Permission::AdminIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 999,
            members: vec![admin_user_id.to_string()],
        },
    );
    groups.insert(
        "Issue Admins".to_string(),
        GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::AdminIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 500,
            members: vec![],
        },
    );
    groups.insert(
        "Issue Editors".to_string(),
        GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 100,
            members: vec![],
        },
    );
    groups.insert(
        "Issue Contributors".to_string(),
        GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 1,
            members: vec!["PUBLIC".to_string()],
        },
    );
    groups
}

/// Writes a root component directory and its `component_metadata` to disk.
///
/// Shared by the `--CreateRootComponent` CLI flag and the `create_root_component`
/// endpoint so the two can never drift apart. It does **not** touch any in-memory cache;
/// callers that have one are responsible for registering `id` themselves.
///
/// Returns the relative path that was created.
pub fn write_root_component(
    root: &std::path::Path,
    id: u32,
    name: &str,
    description: &str,
    admin_user_id: &str,
) -> anyhow::Result<String> {
    // `sanitize_name` maps every non-alphanumeric character to '_', so a name like
    // "!!!" survives as "___" rather than becoming empty. Require a real character.
    if !name.chars().any(|c| c.is_alphanumeric()) {
        anyhow::bail!("Component name must contain at least one alphanumeric character");
    }
    let safe_name = sanitize_name(name);

    let component_path = root.join(&safe_name);
    if component_path.exists() {
        anyhow::bail!("Component directory already exists: {:?}", component_path);
    }

    write_component_metadata_at(&component_path, id, name, description, admin_user_id)?;
    Ok(safe_name)
}

/// Writes a root-style `component_metadata` into `component_path`, creating the
/// directory if needed.
///
/// Unlike `write_root_component` this does **not** refuse an existing directory, which is
/// what lets `ensure_default_component` adopt the empty `default/` folder that older
/// builds left behind.
pub fn write_component_metadata_at(
    component_path: &std::path::Path,
    id: u32,
    name: &str,
    description: &str,
    admin_user_id: &str,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(component_path)?;

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?;

    let mut templates = HashMap::new();
    templates.insert("".to_string(), BugTemplate::default());

    let meta = ComponentMetadata {
        version: CURRENT_VERSION,
        id,
        name: name.to_string(),
        description: description.to_string(),
        creator: admin_user_id.to_string(),
        bug_type: None,
        priority: None,
        severity: None,
        verifier: None,
        collaborators: vec![],
        cc: vec![],
        access_control: AccessControl {
            groups: default_root_groups(admin_user_id),
        },
        templates,
        default_template: "".to_string(),
        user_metadata: vec![],
        created_at: now.as_nanos() as u64,
    };

    let bytes = rkyv::to_bytes::<_, 2048>(&meta)
        .map_err(|e| anyhow::anyhow!("Serialization error: {:?}", e))?;
    std::fs::write(component_path.join("component_metadata"), bytes)?;
    Ok(())
}

/// The display name and folder of the component created automatically on first start.
pub const DEFAULT_COMPONENT_NAME: &str = "DEFAULT";
pub const DEFAULT_COMPONENT_DIR: &str = "default";

/// Ensures a usable top-level component exists, so a fresh install is not a dead end.
///
/// Without this a new deployment has zero components: nothing to nest under, nowhere to
/// file a bug, and the only way forward is an admin creating a root by hand. `DEFAULT` is
/// an ordinary top-level component (its own id, `parent_id` 0) — the super root stays
/// virtual.
///
/// Runs on every start, but only writes when `default/component_metadata` is missing.
/// That makes it self-healing: older builds created an empty `default/` directory and
/// never gave it metadata, so it was invisible to `ComponentIdCache`. Those installs get
/// adopted rather than left broken.
///
/// Returns the id it assigned, or `None` if DEFAULT was already present.
pub fn ensure_default_component(
    root: &std::path::Path,
    admin_user_id: &str,
) -> anyhow::Result<Option<u32>> {
    let component_path = root.join(DEFAULT_COMPONENT_DIR);
    if component_path.join("component_metadata").exists() {
        return Ok(None);
    }

    // Take the next free id from what is already on disk, so adopting an empty
    // `default/` in an install that already has other components cannot collide.
    let mut cache = crate::component_id_cache::ComponentIdCache::default();
    cache.id_to_path.insert(0, "".to_string());
    cache.update_from_disk(root);
    let id = cache.get_next_id();

    write_component_metadata_at(
        &component_path,
        id,
        DEFAULT_COMPONENT_NAME,
        "Default component, created automatically on first start.",
        admin_user_id,
    )?;

    Ok(Some(id))
}

/// Request payload for creating a root-level component.
#[derive(SerdeDeserialize)]
pub struct CreateRootComponentRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Creates a component at the root of the hierarchy. **Admin only.**
///
/// This is deliberately a separate endpoint from `create_component`, which still rejects
/// `parent_id == 0` unconditionally. Root creation is rare, privileged, and cannot
/// inherit permissions from anywhere — folding it into the normal path would mean every
/// ordinary component creation carried a code path that answers to nobody's ACL. Keeping
/// them apart means the common endpoint has no root branch to get wrong.
///
/// Authorization is `is_admin` on the account, not a component ACL: there is no parent
/// component whose permissions could be consulted.
pub async fn create_root_component(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
    Json(payload): Json<CreateRootComponentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    if payload.name.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Serialise root creation against component 0 so two concurrent requests cannot
    // allocate the same id or race on the same directory name.
    let lock = state.get_component_lock(0);
    let _guard = lock.lock().await;

    // See `write_root_component`: a punctuation-only name sanitises to underscores, not
    // to an empty string, so emptiness is not a sufficient check.
    if !payload.name.chars().any(|c| c.is_alphanumeric()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let safe_name = sanitize_name(&payload.name);
    if state.root.join(&safe_name).exists() {
        return Err(StatusCode::CONFLICT);
    }

    let new_id = {
        let cache = state
            .component_cache
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        cache.get_next_id()
    };

    let description = if payload.description.trim().is_empty() {
        format!("Root component: {}", payload.name)
    } else {
        payload.description.clone()
    };

    let created = write_root_component(
        &state.root,
        new_id,
        &payload.name,
        &description,
        &user.username,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Register it so the component list reflects the new root without a restart.
    {
        let mut cache = state
            .component_cache
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        cache.insert(new_id, created);
    }

    Ok((StatusCode::CREATED, Json(new_id)))
}

/// Creates a new component beneath an existing parent.
///
/// NOTE: this endpoint still refuses `parent_id == 0`. Root components are created
/// through the separate admin-only `create_root_component` endpoint (or the
/// `--CreateRootComponent` CLI flag); there is no bootstrap path here.
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
    user: RequestUser,
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
        let path_str = cache
            .get_path(payload.parent_id)
            .ok_or(StatusCode::NOT_FOUND)?;
        let path = state
            .root
            .join(path_str.replace('/', std::path::MAIN_SEPARATOR_STR));
        (path_str, path)
    };

    // 2. Verify parent exists
    if !parent_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Resolve parent metadata for permission check
    let parent_meta = resolve_component_metadata(&state.root, &parent_path_str);

    // 4. Check authorization
    let is_authorized = user.can(&parent_meta, &Permission::ComponentAdmin);
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
    let admins = groups
        .entry("Component Admins".to_string())
        .or_insert_with(|| GroupPermissions {
            permissions: vec![
                Permission::ComponentAdmin,
                Permission::CreateIssues,
                Permission::AdminIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 999,
            members: vec![],
        });
    if !admins.members.contains(&user.username) {
        admins.members.push(user.username.clone());
    }

    // Ensure standard groups exist
    groups
        .entry("Issue Admins".to_string())
        .or_insert_with(|| GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::AdminIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 500,
            members: vec![],
        });
    groups
        .entry("Issue Editors".to_string())
        .or_insert_with(|| GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::EditIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
            ],
            view_level: 100,
            members: vec![],
        });
    groups
        .entry("Issue Contributors".to_string())
        .or_insert_with(|| GroupPermissions {
            permissions: vec![
                Permission::CreateIssues,
                Permission::CommentOnIssues,
                Permission::ViewIssues,
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
        let rel_path = component_path
            .strip_prefix(&state.root)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
        creator: user.username.clone(),
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
    fs::write(component_path.join("component_metadata"), bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::CREATED)
}

/// Request payload for creating a new bug.
#[derive(SerdeDeserialize)]
pub struct CreateBugRequest {
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
    user: RequestUser,
    Json(payload): Json<CreateBugRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // 1 & 2. Resolve component path
    let (component_path_str, component_path) = {
        let cache = state.component_cache.lock().unwrap();
        let path_str = cache
            .get_path(payload.component_id)
            .ok_or(StatusCode::NOT_FOUND)?;
        let path = state
            .root
            .join(path_str.replace('/', std::path::MAIN_SEPARATOR_STR));
        (path_str, path)
    };

    if !component_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 3. Resolve metadata
    let component_meta = resolve_component_metadata(&state.root, &component_path_str);

    // 4. Permission check
    if !user.can(&component_meta, &Permission::CreateIssues) {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Get template, if it doesn't exist fail.
    let template = component_meta
        .templates
        .get(&payload.template_name)
        .ok_or(StatusCode::BAD_REQUEST)?;

    // 6. Generate ID
    let new_id = state.bug_cache.get_next_bug_id();
    state.bug_cache.insert_bug(
        new_id as u64,
        component_path_str
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect(),
    );
    let _ = state.bug_cache.save(&state.root);

    // 7. Initialize metadata
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let created_at = now.as_nanos() as u64;

    // 8. Apply template-based access control
    let mut access = AccessMetadata::default();
    access.full_access.push(user.username.clone());

    match template.default_access {
        TemplateAccess::Default => {}
        TemplateAccess::LimitedComment => {
            access.comment_access.push("PUBLIC".to_string());
        }
        TemplateAccess::LimitedView => {
            access.view_access.push("PUBLIC".to_string());
        }
    }

    let metadata = BugMetadata {
        version: CURRENT_VERSION,
        id: new_id,
        reporter: user.username.clone(),
        bug_type: payload
            .bug_type
            .or(template.bug_type.clone())
            .unwrap_or_else(|| {
                component_meta
                    .bug_type
                    .clone()
                    .unwrap_or_else(|| "Bug".to_string())
            }),
        priority: payload
            .priority
            .or(template.priority.clone())
            .unwrap_or_else(|| {
                component_meta
                    .priority
                    .clone()
                    .unwrap_or_else(|| "P2".to_string())
            }),
        severity: payload
            .severity
            .or(template.severity.clone())
            .unwrap_or_else(|| {
                component_meta
                    .severity
                    .clone()
                    .unwrap_or_else(|| "S2".to_string())
            }),
        status: "New".to_string(),
        assignee: payload
            .assignee
            .or(template.assignee.clone())
            .unwrap_or_default(),
        verifier: payload
            .verifier
            .or(template.verifier.clone())
            .unwrap_or_else(|| component_meta.verifier.clone().unwrap_or_default()),
        collaborators: if !payload.collaborators.is_empty() {
            payload.collaborators.clone()
        } else {
            template.collaborators.clone()
        },
        cc: if !payload.cc.is_empty() {
            payload.cc.clone()
        } else {
            template.cc.clone()
        },
        access,
        title: if payload.title.is_empty() {
            template.title.clone()
        } else {
            payload.title.clone()
        },
        component_id: payload.component_id,
        description: if payload.description.is_empty() {
            template.description.clone()
        } else {
            payload.description.clone()
        },
        user_metadata: vec![],
        created_at,
        state_id: 1,
    };

    // 9. Create directory
    let bug_dir = component_path.join(new_id.to_string());
    fs::create_dir_all(&bug_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 10. Persist metadata
    let bytes =
        rkyv::to_bytes::<_, 8192>(&metadata).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(bug_dir.join("metadata"), bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(new_id))
}

/// Request payload for adding a template.
#[derive(SerdeDeserialize)]
pub struct TemplateRequest {
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
    user: RequestUser,
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
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 4. Permission check
    if !user.can(&meta, &Permission::ComponentAdmin) {
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
    meta.templates
        .insert(payload.template.name.clone(), payload.template);

    // 8. Persist
    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Request payload for modifying a template.
#[derive(SerdeDeserialize)]
pub struct ModifyTemplateRequest {
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
    user: RequestUser,
    Json(payload): Json<ModifyTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !user.can(&meta, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    if !meta.templates.contains_key(&payload.old_name) {
        return Err(StatusCode::NOT_FOUND);
    }

    // Rule: can't rename the 'default template'
    if payload.old_name.is_empty() && payload.template.name != "" {
        return Err(StatusCode::BAD_REQUEST);
    }

    if payload.old_name != payload.template.name
        && meta.templates.contains_key(&payload.template.name)
    {
        return Err(StatusCode::CONFLICT);
    }

    meta.templates.remove(&payload.old_name);
    meta.templates
        .insert(payload.template.name.clone(), payload.template);

    let bytes = rkyv::to_bytes::<_, 2048>(&meta).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&meta_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

/// Request payload for deleting a template.
#[derive(SerdeDeserialize)]
pub struct DeleteTemplateRequest {
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
    user: RequestUser,
    Json(payload): Json<DeleteTemplateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_component_lock(id);
    let _guard = lock.lock().await;

    let component_path = find_component_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;
    let meta_file = component_path.join("component_metadata");

    let data = fs::read(&meta_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !user.can(&meta, &Permission::ComponentAdmin) {
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
    pub metadata: ComponentMetadata,
}

/// Updates the metadata for a specific component.
pub async fn update_component_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    user: RequestUser,
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
    let old_meta: ComponentMetadata = read_versioned::<ComponentMetadata>(&data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 4. Permission check (only ComponentAdmin can update metadata)
    if !user.can(&old_meta, &Permission::ComponentAdmin) {
        return Err(StatusCode::FORBIDDEN);
    }

    // 5. Validation: Ensure ID matches
    if payload.metadata.id != id {
        return Err(StatusCode::BAD_REQUEST);
    }

    // 6. Persist updated metadata
    let bytes = rkyv::to_bytes::<_, 4096>(&payload.metadata)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    let path = {
        let cache = state.component_cache.lock().unwrap();
        cache.get_path(id).ok_or(StatusCode::NOT_FOUND)?
    };
    let resolved = resolve_component_metadata(&state.root, &path);

    if !user.can(&resolved, &Permission::ViewIssues) {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(Json(resolved))
}

/// Retrieves a list of all components (folders) in the system.
///
/// Process:
/// 1. Iterate over all components in the cache.
/// 2. For each component:
///    a. Resolve its hierarchical metadata to check view permissions.
///    b. Read its own metadata to get the display name and description.
///    c. Calculate the parent ID and folders list.
/// 3. Return the collected summaries as JSON.
pub async fn get_component_list(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
) -> impl IntoResponse {
    let mut summaries = Vec::new();
    let cache_data = {
        let cache = state.component_cache.lock().unwrap();
        cache.id_to_path.clone()
    };

    for (id, path_str) in cache_data {
        // Permission check on resolved metadata
        let resolved = resolve_component_metadata(&state.root, &path_str);
        if !user.can(&resolved, &Permission::ViewIssues) {
            continue;
        }

        // Get this component's specific metadata (non-resolved for name/description)
        let component_path = state
            .root
            .join(path_str.replace('/', std::path::MAIN_SEPARATOR_STR));
        let meta_file = component_path.join("component_metadata");

        let (name, description, creator) = if let Ok(data) = fs::read(&meta_file) {
            if let Ok(meta) = read_versioned::<ComponentMetadata>(&data) {
                (meta.name, meta.description, meta.creator)
            } else {
                (
                    path_str.split('/').last().unwrap_or("").to_string(),
                    "".to_string(),
                    "".to_string(),
                )
            }
        } else {
            (
                path_str.split('/').last().unwrap_or("").to_string(),
                "".to_string(),
                "".to_string(),
            )
        };

        let mut folders: Vec<String> = path_str
            .split('/')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        // Remove self from folders
        if !folders.is_empty() {
            folders.pop();
        }

        let parent_path = if path_str.contains('/') {
            path_str.rsplitn(2, '/').nth(1).unwrap_or("")
        } else {
            ""
        };

        let parent_id = if parent_path.is_empty() {
            0
        } else {
            let cache = state.component_cache.lock().unwrap();
            cache.get_id(parent_path).unwrap_or(0)
        };

        summaries.push(ComponentSummary {
            id,
            name,
            description,
            folders,
            parent_id,
            creator,
        });
    }

    summaries.sort_by(|a, b| {
        let a_full = a.folders.join("/") + "/" + &a.name;
        let b_full = b.folders.join("/") + "/" + &b.name;
        a_full.cmp(&b_full)
    });

    Json(summaries)
}

fn match_condition(key: &str, values: &[String], metadata: &BugMetadata, is_exclude: bool) -> bool {
    // Distinct keywords are ANDed together, so "any of these fields mentions X" cannot be
    // expressed by combining `reporter:` and `assignee:`. `involves:` exists for that:
    // it matches if the value appears in *any* participant field, which is what an
    // account page means by "bugs I am on".
    let fields: Vec<String> = match key.to_lowercase().as_str() {
        "id" => vec![metadata.id.to_string()],
        "status" => vec![metadata.status.clone()],
        "priority" => vec![metadata.priority.clone()],
        "severity" => vec![metadata.severity.clone()],
        "type" => vec![metadata.bug_type.clone()],
        "assignee" => vec![metadata.assignee.clone()],
        "reporter" => vec![metadata.reporter.clone()],
        "verifier" => vec![metadata.verifier.clone()],
        "cc" => metadata.cc.clone(),
        "collaborator" => metadata.collaborators.clone(),
        "componentid" => vec![metadata.component_id.to_string()],
        "involves" => {
            let mut all = vec![
                metadata.reporter.clone(),
                metadata.assignee.clone(),
                metadata.verifier.clone(),
            ];
            all.extend(metadata.collaborators.iter().cloned());
            all.extend(metadata.cc.iter().cloned());
            all
        }
        _ => return !is_exclude, // Unknown fields don't match, so include fails, exclude passes (not excluded)
    };

    for field_value in &fields {
    for val in values {
        // Support regex if val starts and ends with /
        if val.starts_with('/') && val.ends_with('/') && val.len() > 2 {
            let pattern = &val[1..val.len() - 1];
            if let Ok(re) = regex::RegexBuilder::new(pattern)
                .case_insensitive(true)
                .build()
            {
                if re.is_match(field_value) {
                    return true;
                }
            }
        } else if field_value.to_lowercase().contains(&val.to_lowercase()) {
            return true;
        }
    }
    }

    false
}

// Checks if the bug metadata matches the parsed search string.
fn match_entry(search_query: &SearchString, metadata: &BugMetadata) -> bool {
    let parsed_query = search_query.get_parsed_query();

    // First check all the text segments in the search query.
    for text_segment in &search_query.text_segments {
        let mut found_text_entries: bool = false;
        if metadata
            .description
            .to_lowercase()
            .contains(&text_segment.text)
            ^ text_segment.negated
        {
            found_text_entries = true;
        } else if metadata.title.to_lowercase().contains(&text_segment.text) ^ text_segment.negated
        {
            found_text_entries = true;
        }
        if !found_text_entries {
            return false;
        }
    }
    // TODO: Add check for text within comments.

    for (key, values) in &parsed_query.include {
        if !match_condition(key, values, &metadata, false) {
            return false;
        }
    }

    for (key, values) in &parsed_query.exclude {
        if match_condition(key, values, &metadata, true) {
            return false;
        }
    }

    true
}

/// Retrieves a list of bugs matching the search criteria.
///
/// Process:
/// 1. Recursively scan the root for files named "metadata".
/// 2. For each metadata file:
///    a. Deserialize the `BugMetadata`.
///    b. Check if the requesting user has at least `View` access.
///    c. Parse the search query `q` into `SearchString`.
///    d. Match conditions and text segments against metadata.
///    e. If it matches, add a `BugSummary` to the result list.
/// 3. Return the collected summaries as JSON.
pub async fn get_bug_list(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let mut summaries = Vec::new();
    let q_str = query.q.unwrap_or_default();
    let search_query: SearchString = SearchString::parse(&q_str);

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

        if user.bug_access(&metadata, &resolved_meta) < UserAccessLevel::View {
            continue;
        }

        if search_query.is_empty() || match_entry(&search_query, &metadata) {
            let last_updated_at = fs::metadata(entry.path())
                .and_then(|m| m.modified())
                .map(|t| {
                    t.duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos() as u64
                })
                .unwrap_or(metadata.created_at);
            summaries.push(BugSummary {
                id: metadata.id,
                title: metadata.title.clone(),
                description: metadata.description.clone(),
                status: metadata.status.clone(),
                priority: metadata.priority.clone(),
                severity: metadata.severity.clone(),
                bug_type: metadata.bug_type.clone(),
                created_at: metadata.created_at,
                last_updated_at,
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
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    let bug_path = find_bug_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;

    let metadata_data =
        fs::read(bug_path.join("metadata")).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let metadata: BugMetadata = read_versioned::<BugMetadata>(&metadata_data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (resolved_meta, folders, folder_ids) = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache
            .get_path(metadata.component_id)
            .unwrap_or_default();
        let mut folders = Vec::new();
        let mut folder_ids = Vec::new();
        let mut current_path = String::new();
        for comp in path.split('/').filter(|s| !s.is_empty()) {
            if !current_path.is_empty() {
                current_path.push('/');
            }
            current_path.push_str(comp);
            folders.push(comp.to_string());
            if let Some(id) = component_cache.get_id(&current_path) {
                folder_ids.push(id);
            }
        }
        (
            resolve_component_metadata(&state.root, &path),
            folders,
            folder_ids,
        )
    };

    if user.bug_access(&metadata, &resolved_meta) < UserAccessLevel::View {
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
        folder_ids,
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
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    let bug_path = find_bug_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;

    let metadata_data =
        fs::read(bug_path.join("metadata")).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let metadata: BugMetadata = read_versioned::<BugMetadata>(&metadata_data)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache
            .get_path(metadata.component_id)
            .unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if user.bug_access(&metadata, &resolved_meta) < UserAccessLevel::View {
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(Json(BugStateResponse {
        state_id: metadata.state_id,
    }))
}

/// Request payload for submitting a new comment.
///
/// There is deliberately no `author` field. It used to be client-supplied alongside a
/// separate `u`, with nothing enforcing the two matched — so any caller could attribute
/// a comment to someone else. The author is now taken from the authenticated token.
#[derive(SerdeDeserialize)]
pub struct CommentRequest {
    pub content: String,
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
    user: RequestUser,
    Json(payload): Json<CommentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_bug_lock(id);
    let _guard = lock.lock().await;
    let bug_path = find_bug_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;

    let metadata_file = bug_path.join("metadata");
    let data = fs::read(&metadata_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut metadata: BugMetadata =
        read_versioned::<BugMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache
            .get_path(metadata.component_id)
            .unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if user.bug_access(&metadata, &resolved_meta) < UserAccessLevel::Comment {
        return Err(StatusCode::FORBIDDEN);
    }

    metadata.state_id += 1;
    let new_state_id = metadata.state_id;
    let bytes =
        rkyv::to_bytes::<_, 1024>(&metadata).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(&metadata_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let next_comment_id = state.bug_cache.get_next_comment_id(id as u64);
    let _ = state.bug_cache.save(&state.root);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let comment = Comment {
        version: CURRENT_VERSION,
        id: next_comment_id,
        author: user.username.clone(),
        epoch_nanoseconds: now.as_nanos() as u64,
        content: payload.content,
    };

    let bytes =
        rkyv::to_bytes::<_, 256>(&comment).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(
        bug_path.join(format!("comment_{:07}", next_comment_id)),
        bytes,
    )
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
pub async fn update_bug_metadata(
    State(state): State<Arc<AppState>>,
    Path(id): Path<u32>,
    user: RequestUser,
    Json(payload): Json<MetadataChangeRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let lock = state.get_bug_lock(id);
    let _guard = lock.lock().await;
    let bug_path = find_bug_path(&state, id).ok_or(StatusCode::NOT_FOUND)?;

    let metadata_file = bug_path.join("metadata");
    let data = fs::read(&metadata_file).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut metadata: BugMetadata =
        read_versioned::<BugMetadata>(&data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let resolved_meta = {
        let component_cache = state.component_cache.lock().unwrap();
        let path = component_cache
            .get_path(metadata.component_id)
            .unwrap_or_default();
        resolve_component_metadata(&state.root, &path)
    };

    if user.bug_access(&metadata, &resolved_meta) < UserAccessLevel::Full {
        return Err(StatusCode::FORBIDDEN);
    }

    match payload.field.as_str() {
        "status" => metadata.status = payload.value,
        "priority" => metadata.priority = payload.value,
        "severity" => metadata.severity = payload.value,
        "assignee" => metadata.assignee = payload.value,
        "type" => metadata.bug_type = payload.value,
        "title" => metadata.title = payload.value,
        "description" => metadata.description = payload.value,
        "collaborators" => {
            metadata.collaborators = payload
                .value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        "cc" => {
            metadata.cc = payload
                .value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        "verifier" => metadata.verifier = payload.value,
        "full_access" => {
            metadata.access.full_access = payload
                .value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        "comment_access" => {
            metadata.access.comment_access = payload
                .value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        "view_access" => {
            metadata.access.view_access = payload
                .value
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        }
        _ => {
            if let Some(entry) = metadata
                .user_metadata
                .iter_mut()
                .find(|m| m.key == payload.field)
            {
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

    let bytes =
        rkyv::to_bytes::<_, 1024>(&metadata).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    fs::write(metadata_file, bytes).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
    T::Archived: for<'a> rkyv::CheckBytes<rkyv::validation::validators::DefaultValidator<'a>>
        + rkyv::Deserialize<T, rkyv::de::deserializers::SharedDeserializeMap>,
{
    match rkyv::from_bytes::<T>(data) {
        Ok(val) => Ok(val),
        Err(e) => {
            let err_msg = format!("Rkyv deserialization error: {:?}", e);
            tracing::error!("{}", err_msg);
            Err(err_msg)
        }
    }
}

#[cfg(test)]
mod api_test;
