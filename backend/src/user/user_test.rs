use super::*;
use tempfile::tempdir;

#[tokio::test]
async fn test_user_manager_basic() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("users.json");
    let manager = UserManager::new(&db_path).await?;

    // Test create user (Firebase only)
    let uid = manager.create_user("fbuser", Some("fb_uid_123".to_string()), None).await?;
    assert_eq!(uid, 1);

    // Test has_username
    assert!(manager.has_username("fbuser").await);
    
    // Test get_user
    let user = manager.get_user(UserIdentifier::FirebaseUid("fb_uid_123".to_string())).await.unwrap();
    assert_eq!(user.username, "fbuser");

    Ok(())
}

#[tokio::test]
async fn test_native_user() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("users.json");
    let manager = UserManager::new(&db_path).await?;

    // Create native user
    let uid = manager.create_user("alice", None, Some("password123")).await?;
    
    // Verify password
    let verified_uid = manager.verify_password("alice", "password123").await?;
    assert_eq!(uid, verified_uid);

    // Invalid password
    assert!(manager.verify_password("alice", "wrong").await.is_err());

    Ok(())
}

#[tokio::test]
async fn test_service_accounts() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("users.json");
    let manager = UserManager::new(&db_path).await?;

    let sa_id = manager.create_service_account("bot1", "secret-key-123").await?;
    
    // Verify key
    let verified_id = manager.verify_service_key("secret-key-123").await?;
    assert_eq!(sa_id, verified_id);

    // Invalid key
    assert!(manager.verify_service_key("wrong-key").await.is_err());

    Ok(())
}

#[tokio::test]
async fn test_refresh_tokens() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("users.json");
    let manager = UserManager::new(&db_path).await?;

    let expires = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos() as u64 + 1_000_000_000; // 1 second in future

    manager.add_refresh_token(10, false, "refresh-token-456", expires).await?;
    
    // Verify and consume
    let (uid, is_sa) = manager.verify_and_consume_refresh_token("refresh-token-456").await?;
    assert_eq!(uid, 10);
    assert!(!is_sa);

    // Token should be consumed
    assert!(manager.verify_and_consume_refresh_token("refresh-token-456").await.is_err());

    Ok(())
}

#[tokio::test]
async fn test_refresh_token_expiry() -> anyhow::Result<()> {
    let dir = tempdir()?;
    let db_path = dir.path().join("users.json");
    let manager = UserManager::new(&db_path).await?;

    let expired = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos() as u64 - 1000;

    manager.add_refresh_token(20, false, "expired-token", expired).await?;
    
    // Should fail and delete
    assert!(manager.verify_and_consume_refresh_token("expired-token").await.is_err());
    
    // Check it's gone
    let db = manager.db.read().await;
    let data = db.data().await.get("data")?.into::<UserDb>()?;
    assert!(data.refresh_tokens.is_empty());

    Ok(())
}
