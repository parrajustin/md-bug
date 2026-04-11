use super::*;
use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::Json;
use tempfile::tempdir;
use std::fs;
use std::sync::{Arc, Mutex};
use std::path::Path as StdPath;
use axum::http::StatusCode;
use crate::bug_id_cache::BugIdCache;

fn create_test_bug(root: &StdPath, id: u32, component_id: u32, folders: Vec<String>) -> anyhow::Result<std::path::PathBuf> {
    let mut bug_path = root.to_path_buf();
    for folder in &folders {
        bug_path.push(folder);
    }
    bug_path.push(id.to_string());
    fs::create_dir_all(&bug_path)?;

    let metadata = BugMetadata {
        version: CURRENT_VERSION,
        id,
        reporter: "test@example.com".to_string(),
        bug_type: "Bug".to_string(),
        priority: "P1".to_string(),
        severity: "S1".to_string(),
        status: "New".to_string(),
        assignee: "none".to_string(),
        verifier: "".to_string(),
        collaborators: vec![],
        cc: vec![],
        access: AccessMetadata {
            version: CURRENT_VERSION,
            full_access: vec![],
            comment_access: vec!["PUBLIC".to_string()],
            view_access: vec![],
        },
        title: format!("Test Bug {}", id),
        component_id,
        description: "Test bug description".to_string(),
        user_metadata: vec![],
        created_at: 123456789,
        state_id: 1,
    };

    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(bug_path.join("metadata"), bytes)?;
    Ok(bug_path)
}

fn create_test_component(root: &StdPath, path: &str, name: &str, admins: Vec<String>, contributors: Vec<String>) -> anyhow::Result<std::path::PathBuf> {
    let comp_path = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    fs::create_dir_all(&comp_path)?;

    let mut groups = HashMap::new();
    groups.insert("Component Admins".to_string(), GroupPermissions {
        permissions: vec![Permission::ComponentAdmin, Permission::ViewIssues, Permission::CommentOnIssues, Permission::EditIssues],
        view_level: 999,
        members: admins,
    });
    groups.insert("Issue Contributors".to_string(), GroupPermissions {
        permissions: vec![Permission::CreateIssues, Permission::CommentOnIssues, Permission::ViewIssues],
        view_level: 1,
        members: contributors,
    });

    let mut templates = HashMap::new();
    templates.insert("".to_string(), BugTemplate::default());

    let meta = ComponentMetadata {
        version: CURRENT_VERSION,
        id: 0,
        name: name.to_string(),
        description: "Test component".to_string(),
        creator: "admin".to_string(),
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
        created_at: 123456789,
    };

    let bytes = rkyv::to_bytes::<_, 2048>(&meta)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(comp_path.join("component_metadata"), bytes)?;
    Ok(comp_path)
}

#[tokio::test]
async fn test_access_control_inheritance() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    // Create hierarchy: root -> parent -> child
    create_test_component(root, "parent", "Parent", vec!["parent_admin".to_string()], vec![])?;
    create_test_component(root, "parent/child", "Child", vec!["child_admin".to_string()], vec!["contributor".to_string()])?;
    
    // Create bug in child component
    create_test_bug(root, 1, 1, vec!["parent".to_string(), "child".to_string()])?;
    
    let mut component_cache = ComponentIdCache::default();
    component_cache.insert(0, "".to_string());
    component_cache.insert(1, "parent/child".to_string());

    let cache = BugIdCache::load_and_update(root);
    let state = Arc::new(AppState { 
        root: root.to_path_buf(),
        bug_cache: cache,
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // Case 1: parent_admin should have Full access via inheritance
    let res = get_bug(State(state.clone()), Path(1), Query(BugQuery { u: "parent_admin".to_string() })).await.into_response();
    assert_eq!(res.status(), StatusCode::OK);

    // Case 2: contributor should have View access
    let res = get_bug(State(state.clone()), Path(1), Query(BugQuery { u: "contributor".to_string() })).await.into_response();
    assert_eq!(res.status(), StatusCode::OK);

    // Case 3: random_user should be Forbidden (default bug created by create_test_bug only has PUBLIC Comment access)
    // Wait, create_test_bug adds PUBLIC to comment_access.
    // Let's modify bug metadata to remove PUBLIC access for strict test.
    let bug_path = root.join("parent").join("child").join("1");
    let data = fs::read(bug_path.join("metadata"))?;
    let mut bug_meta: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    bug_meta.access.comment_access.clear();
    let bytes = rkyv::to_bytes::<_, 1024>(&bug_meta).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(bug_path.join("metadata"), bytes)?;

    let res = get_bug(State(state.clone()), Path(1), Query(BugQuery { u: "random_user".to_string() })).await.into_response();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // Case 4: child_admin should have Full access
    let res = get_bug(State(state.clone()), Path(1), Query(BugQuery { u: "child_admin".to_string() })).await.into_response();
    assert_eq!(res.status(), StatusCode::OK);

    Ok(())
}

#[tokio::test]
async fn test_create_component_permissions() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    let mut component_cache = ComponentIdCache::default();
    component_cache.insert(0, "".to_string());

    let state = Arc::new(AppState { 
        root: root.to_path_buf(),
        bug_cache: BugIdCache::new(),
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // Case 1: Root creation attempt via API - SHOULD BE FORBIDDEN
    let req = CreateComponentRequest {
        u: "first_user".to_string(),
        name: "Root Comp".to_string(),
        description: "First one".to_string(),
        parent_id: 0,
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // Now create a component manually to test sub-component creation
    create_test_component(root, "manual_root", "Manual Root", vec!["admin_user".to_string()], vec![])?;
    {
        let mut cache = state.component_cache.lock().unwrap();
        cache.insert(1, "manual_root".to_string());
    }
    
    // Case 2: unauthorized user tries to create sub-component
    let req = CreateComponentRequest {
        u: "intruder".to_string(),
        name: "Hack".to_string(),
        description: "Evil".to_string(),
        parent_id: 1, 
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // Case 3: authorized admin creates sub-component
    let req = CreateComponentRequest {
        u: "admin_user".to_string(),
        name: "Sub Comp".to_string(),
        description: "Child".to_string(),
        parent_id: 1,
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::CREATED);

    Ok(())
}

#[tokio::test]
async fn test_create_component_collisions() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    let mut component_cache = ComponentIdCache::default();
    component_cache.insert(0, "".to_string());

    let state = Arc::new(AppState { 
        root: root.to_path_buf(),
        bug_cache: BugIdCache::new(),
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // Create initial manual root
    create_test_component(root, "manual_root", "Manual Root", vec!["admin".to_string()], vec![])?;
    {
        let mut cache = state.component_cache.lock().unwrap();
        cache.insert(1, "manual_root".to_string());
    }

    // Create initial component under manual root
    let req = CreateComponentRequest {
        u: "admin".to_string(),
        name: "My Comp".to_string(), // safe name: my_comp
        description: "Desc".to_string(),
        parent_id: 1,
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Case 1: Conflict by Name (not folder name)
    let req = CreateComponentRequest {
        u: "admin".to_string(),
        name: "My Comp".to_string(), // Exact same name
        description: "Another".to_string(),
        parent_id: 1,
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // Case 2: Conflict by Folder (sanitization)
    let req = CreateComponentRequest {
        u: "admin".to_string(),
        name: "my-comp".to_string(),
        description: "Different name, same folder".to_string(),
        parent_id: 1,
    };
    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::CREATED); 
    
    assert!(root.join("manual_root").join("my_comp").exists());
    assert!(root.join("manual_root").join("my_comp_1").exists());

    Ok(())
}

#[tokio::test]
async fn test_create_component_group_inheritance() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    let mut component_cache = ComponentIdCache::default();
    component_cache.insert(0, "".to_string());

    let state = Arc::new(AppState { 
        root: root.to_path_buf(),
        bug_cache: BugIdCache::new(),
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // 1. Create parent component with default groups and a special group
    // "admin" is added to admins so they can create the child.
    let parent_path = create_test_component(root, "parent", "Parent", vec!["parent_admin".to_string(), "admin".to_string()], vec![])?;
    
    // Manually add "super_vis_admin" to parent
    let data = fs::read(parent_path.join("component_metadata"))?;
    let mut parent_meta: ComponentMetadata = rkyv::from_bytes::<ComponentMetadata>(&data).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    
    parent_meta.access_control.groups.insert("super_vis_admin".to_string(), GroupPermissions {
        permissions: vec![
            Permission::ComponentAdmin, Permission::CreateIssues, Permission::AdminIssues,
            Permission::EditIssues, Permission::CommentOnIssues, Permission::ViewIssues
        ],
        view_level: 10000,
        members: vec!["parent_admin".to_string(), "parent_parent_admin".to_string()],
    });
    
    let bytes = rkyv::to_bytes::<_, 2048>(&parent_meta).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(parent_path.join("component_metadata"), bytes)?;

    // 2. Call create_component API to create child as "admin"
    let req = CreateComponentRequest {
        u: "admin".to_string(),
        name: "Child".to_string(),
        description: "Child component".to_string(),
        parent_id: 1,
    };
    
    // We need parent in cache
    {
        let mut cache = state.component_cache.lock().unwrap();
        cache.insert(1, "parent".to_string());
    }

    let res = create_component(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 3. Verify child metadata
    let child_meta_path = root.join("parent").join("child").join("component_metadata");
    assert!(child_meta_path.exists());
    
    let data = fs::read(child_meta_path)?;
    let child_meta: ComponentMetadata = rkyv::from_bytes::<ComponentMetadata>(&data).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    
    // Verify "admin" is in Component Admins
    let admins = child_meta.access_control.groups.get("Component Admins").expect("Component Admins missing");
    assert!(admins.members.contains(&"admin".to_string()));
    assert!(admins.members.contains(&"parent_admin".to_string())); // Copied from parent
    
    // Verify "super_vis_admin" group is present and copied correctly
    let super_group = child_meta.access_control.groups.get("super_vis_admin").expect("super_vis_admin missing");
    assert_eq!(super_group.view_level, 10000);
    assert!(super_group.members.contains(&"parent_admin".to_string()));
    assert!(super_group.members.contains(&"parent_parent_admin".to_string()));

    Ok(())
}

#[tokio::test]
async fn test_create_and_get_bug() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 1, 1, vec!["google".to_string(), "sxs".to_string()])?;
    
    // Load cache after creating bug
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        bug_cache: cache,
        component_cache: Mutex::new(ComponentIdCache::default()),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    let response = get_bug(State(state.clone()), Path(1), Query(BugQuery { u: "test@example.com".to_string() })).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024).await?;
    let json: serde_json::Value = serde_json::from_slice(&body)?;

    // Verify custom serialization for u64 and presence of state_id
    assert_eq!(json["state_id"], "1n");
    assert_eq!(json["metadata"]["created_at"], "123456789n");
    assert_eq!(json["metadata"]["state_id"], "1n");
    
    Ok(())
}

#[tokio::test]
async fn test_submit_comment() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 42, 1, vec!["test".to_string()])?;
    
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        bug_cache: cache,
        component_cache: Mutex::new(ComponentIdCache::default()),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    let req = CommentRequest {
        author: "alice".to_string(),
        content: "Hello world".to_string(),
        u: "alice".to_string(),
    };

    let response = submit_comment(State(state.clone()), Path(42), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024).await?;
    let json: serde_json::Value = serde_json::from_slice(&body)?;
    
    // Verify response contains new state_id in correct format
    assert_eq!(json["state_id"], "2n");
    assert_eq!(json["comment_id"], 1);

    let bug_path = dir.path().join("test").join("42");
    let data = fs::read(bug_path.join("metadata"))?;
    let metadata: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(metadata.state_id, 2);

    let comment_file = bug_path.join("comment_0000001");
    assert!(comment_file.exists());

    let data = fs::read(comment_file)?;
    let comment: Comment = rkyv::from_bytes::<Comment>(&data)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(comment.author, "alice");
    assert_eq!(comment.content, "Hello world");
    Ok(())
}

#[tokio::test]
async fn test_update_bug_metadata() -> anyhow::Result<()> {
    let dir = tempdir()?;
    create_test_bug(dir.path(), 100, 1, vec!["meta".to_string()])?;
    
    let cache = BugIdCache::load_and_update(dir.path());
    let state = Arc::new(AppState { 
        root: dir.path().to_path_buf(),
        bug_cache: cache,
        component_cache: Mutex::new(ComponentIdCache::default()),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // Note: create_test_bug by default only gives Comment access to PUBLIC.
    // We need to either give Full access to "admin" or use a user with Full access.
    // Let's modify the bug's metadata to give Full access to "admin".
    let bug_path = dir.path().join("meta").join("100");
    let data = fs::read(bug_path.join("metadata"))?;
    let mut metadata: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    metadata.access.full_access.push("admin".to_string());
    let bytes = rkyv::to_bytes::<_, 1024>(&metadata)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    fs::write(bug_path.join("metadata"), bytes)?;

    let req = MetadataChangeRequest {
        field: "status".to_string(),
        value: "In Progress".to_string(),
        u: "admin".to_string(),
    };

    let response = update_bug_metadata(State(state.clone()), Path(100), Json(req)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024).await?;
    let json: serde_json::Value = serde_json::from_slice(&body)?;
    
    // Verify response contains new state_id in correct format
    assert_eq!(json["state_id"], "2n");

    let data = fs::read(bug_path.join("metadata"))?;
    let metadata: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(metadata.status, "In Progress");
    assert_eq!(metadata.state_id, 2);

    // Test user metadata
    let req_user = MetadataChangeRequest {
        field: "Team".to_string(),
        value: "Perception".to_string(),
        u: "admin".to_string(),
    };
    let response = update_bug_metadata(State(state.clone()), Path(100), Json(req_user)).await.into_response();
    assert_eq!(response.status(), StatusCode::OK);

    let data = fs::read(bug_path.join("metadata"))?;
    let metadata: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    assert_eq!(metadata.state_id, 3);
    let team = metadata.user_metadata.iter().find(|m| m.key == "Team")
        .ok_or_else(|| anyhow::anyhow!("Team metadata not found"))?;
    assert_eq!(team.value, "Perception");
    Ok(())
}

#[tokio::test]
async fn test_create_bug_with_template_access() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    // 1. Create component with a Limited Comment template
    let mut templates = HashMap::new();
    templates.insert("limited".to_string(), BugTemplate {
        name: "limited".to_string(),
        default_access: TemplateAccess::LimitedComment,
        ..BugTemplate::default()
    });
    
    // We need to set component ID for cache
    let comp_id = 10;
    let mut component_cache = ComponentIdCache::default();
    component_cache.insert(comp_id, "test_comp".to_string());
    
    let comp_path = root.join("test_comp");
    fs::create_dir_all(&comp_path)?;
    
    let mut groups = HashMap::new();
    groups.insert("Issue Contributors".to_string(), GroupPermissions {
        permissions: vec![Permission::CreateIssues, Permission::ViewIssues, Permission::CommentOnIssues],
        view_level: 1,
        members: vec!["PUBLIC".to_string()],
    });

    let meta = ComponentMetadata {
        version: CURRENT_VERSION,
        id: comp_id,
        name: "Test Comp".to_string(),
        description: "Desc".to_string(),
        creator: "admin".to_string(),
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
        created_at: 123456789,
    };
    let bytes = rkyv::to_bytes::<_, 2048>(&meta).unwrap();
    fs::write(comp_path.join("component_metadata"), bytes).unwrap();

    let state = Arc::new(AppState { 
        root: root.to_path_buf(),
        bug_cache: BugIdCache::new(),
        component_cache: Mutex::new(component_cache),
        bug_locks: Mutex::new(HashMap::new()),
        component_locks: Mutex::new(HashMap::new()),
    });

    // 2. Create bug using the template
    let req = CreateBugRequest {
        u: "user1".to_string(),
        component_id: comp_id,
        template_name: "limited".to_string(),
        title: "Template Bug".to_string(),
        description: "Testing access".to_string(),
        bug_type: None,
        priority: None,
        severity: None,
        assignee: None,
        verifier: None,
        collaborators: vec![],
        cc: vec![],
        created_at: None,
    };

    let res = create_bug(State(state.clone()), Json(req)).await.into_response();
    assert_eq!(res.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(res.into_body(), 1024).await?;
    let bug_id: u32 = serde_json::from_slice(&body)?;
    assert_eq!(bug_id, 1);

    // 3. Verify bug access metadata
    let bug_dir = comp_path.join("1");
    let data = fs::read(bug_dir.join("metadata"))?;
    let bug_meta: BugMetadata = rkyv::from_bytes::<BugMetadata>(&data).unwrap();
    
    assert!(bug_meta.access.comment_access.contains(&"PUBLIC".to_string()));
    assert!(!bug_meta.access.view_access.contains(&"PUBLIC".to_string()));

    Ok(())
}
