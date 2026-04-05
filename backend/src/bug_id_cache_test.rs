use super::*;
use tempfile::tempdir;
use std::fs;

#[test]
fn test_cache_update_from_disk() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    // Create a mock directory structure
    // root/google/perception/100
    let bug_100_path = root.join("google").join("perception").join("100");
    fs::create_dir_all(&bug_100_path)?;
    
    // root/default/200
    let bug_200_path = root.join("default").join("200");
    fs::create_dir_all(&bug_200_path)?;

    // root/300 (top level)
    let bug_300_path = root.join("300");
    fs::create_dir_all(&bug_300_path)?;

    // root/__hidden/400 (should be skipped)
    let bug_400_path = root.join("__hidden").join("400");
    fs::create_dir_all(&bug_400_path)?;

    // root/google/invalid_name/500 (should be skipped if "invalid_name" was a number, but here it's fine)
    // Wait, components cannot be numbers. Let's test that.
    let bug_invalid_path = root.join("123").join("456");
    fs::create_dir_all(&bug_invalid_path)?;

    let mut cache = BugIdCache::default();
    cache.update_from_disk(root);

    assert_eq!(cache.id_to_components.get(&100), Some(&vec!["google".to_string(), "perception".to_string()]));
    assert_eq!(cache.id_to_components.get(&200), Some(&vec!["default".to_string()]));
    assert_eq!(cache.id_to_components.get(&300), Some(&vec![]));
    assert_eq!(cache.id_to_components.get(&400), None); // Skipped because of __
    
    // 123 is a number, so it should be treated as a bug ID, and 456 should be skipped as a sub-component
    assert_eq!(cache.id_to_components.get(&123), Some(&vec![]));
    assert_eq!(cache.id_to_components.get(&456), None);

    Ok(())
}

#[test]
fn test_cache_save_and_load() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    let mut cache = BugIdCache::default();
    cache.id_to_components.insert(123, vec!["comp1".to_string()]);
    cache.save(root)?;

    let cache_path = root.join("__bug_id_cache__");
    assert!(cache_path.exists());

    // Load and update (update should be a no-op if no new folders)
    let loaded_cache = BugIdCache::load_and_update(root);
    assert_eq!(loaded_cache.id_to_components.get(&123), Some(&vec!["comp1".to_string()]));

    Ok(())
}

#[test]
fn test_get_path() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let root = dir.path();

    let mut cache = BugIdCache::default();
    cache.id_to_components.insert(100, vec!["google".to_string(), "perception".to_string()]);

    let path = cache.get_path(root, 100);
    assert_eq!(path, Some(root.join("google").join("perception").join("100")));

    let no_path = cache.get_path(root, 999);
    assert_eq!(no_path, None);

    Ok(())
}
