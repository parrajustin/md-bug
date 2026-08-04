use super::*;
use crate::auth::TokenKind;
use tempfile::tempdir;

async fn manager() -> (UserManager, tempfile::TempDir) {
    let dir = tempdir().expect("tempdir");
    let path = dir.path().join("users.json");
    let mgr = UserManager::new(&path).await.expect("open user db");
    (mgr, dir)
}

#[tokio::test]
async fn creates_and_looks_up_a_user() {
    let (mgr, _dir) = manager().await;

    let uid = mgr
        .create_user("fbuser", Some("fb_uid_123".into()), None, false, false)
        .await
        .expect("create");
    assert_eq!(uid, 1);
    assert!(mgr.has_username("fbuser").await);
    assert!(mgr.has_uid(uid).await);
    assert!(mgr.has_firebase_uid("fb_uid_123").await);

    let user = mgr
        .get_user(UserIdentifier::FirebaseUid("fb_uid_123".into()))
        .await
        .expect("user exists");
    assert_eq!(user.username, "fbuser");
    assert!(!user.is_admin);
    assert!(!user.must_change_password);
}

#[tokio::test]
async fn rejects_duplicate_usernames() {
    let (mgr, _dir) = manager().await;

    mgr.create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("first create");
    assert!(
        mgr.create_user("alice", None, Some("other"), false, false)
            .await
            .is_err(),
        "duplicate username must be rejected"
    );
}

#[tokio::test]
async fn verifies_passwords_and_rejects_wrong_ones() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("correct horse"), false, false)
        .await
        .expect("create");

    assert_eq!(
        mgr.verify_password("alice", "correct horse")
            .await
            .expect("valid password"),
        uid
    );
    assert!(mgr.verify_password("alice", "wrong").await.is_err());
    assert!(mgr.verify_password("nobody", "correct horse").await.is_err());
}

#[tokio::test]
async fn never_stores_the_password_in_plaintext() {
    let (mgr, _dir) = manager().await;
    mgr.create_user("alice", None, Some("super-secret"), false, false)
        .await
        .expect("create");

    let user = mgr
        .get_user(UserIdentifier::Username("alice".into()))
        .await
        .expect("user exists");
    let hash = user.password_hash.expect("password set");

    assert!(!hash.contains("super-secret"));
    assert!(hash.starts_with("$argon2"), "expected an Argon2 PHC string");
}

#[tokio::test]
async fn set_password_rotates_and_clears_the_force_flag() {
    let (mgr, _dir) = manager().await;
    mgr.create_user("alice", None, Some("initial"), false, true)
        .await
        .expect("create");

    let before = mgr
        .get_user(UserIdentifier::Username("alice".into()))
        .await
        .expect("user");
    assert!(before.must_change_password);

    mgr.set_password("alice", "replacement").await.expect("set password");

    let after = mgr
        .get_user(UserIdentifier::Username("alice".into()))
        .await
        .expect("user");
    assert!(!after.must_change_password);
    assert!(mgr.verify_password("alice", "replacement").await.is_ok());
    assert!(
        mgr.verify_password("alice", "initial").await.is_err(),
        "the old password must stop working"
    );
}

#[tokio::test]
async fn issues_and_verifies_a_token() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let token = mgr
        .issue_token("alice", uid, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");

    let verified = mgr
        .verify_token(&token.plaintext, TokenKind::Access)
        .await
        .expect("token verifies");
    assert_eq!(verified.username, "alice");
    assert_eq!(verified.uid, uid);
}

#[tokio::test]
async fn rejects_a_token_of_the_wrong_kind() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let refresh = mgr
        .issue_token("alice", uid, TokenKind::Refresh, None, None, Some(3600))
        .await
        .expect("issue");

    // A refresh token must not be accepted where an access token is required.
    assert!(mgr
        .verify_token(&refresh.plaintext, TokenKind::Access)
        .await
        .is_none());
    assert!(mgr
        .verify_token(&refresh.plaintext, TokenKind::Refresh)
        .await
        .is_some());
}

#[tokio::test]
async fn rejects_a_forged_token() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let token = mgr
        .issue_token("alice", uid, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");

    assert!(mgr
        .verify_token(&format!("{}x", token.plaintext), TokenKind::Access)
        .await
        .is_none());

    // Real token id, attacker-chosen secret.
    let (_, id, _) = crate::auth::parse_token(&token.plaintext).expect("parse");
    let forged = format!("mdb_at_{}.{}", id, crate::auth::generate_secret());
    assert!(mgr.verify_token(&forged, TokenKind::Access).await.is_none());
}

#[tokio::test]
async fn consume_token_is_single_use() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let token = mgr
        .issue_token("alice", uid, TokenKind::Refresh, None, None, Some(3600))
        .await
        .expect("issue");

    assert!(mgr
        .consume_token(&token.plaintext, TokenKind::Refresh)
        .await
        .is_some());
    assert!(
        mgr.consume_token(&token.plaintext, TokenKind::Refresh)
            .await
            .is_none(),
        "a consumed refresh token must not be reusable"
    );
}

#[tokio::test]
async fn expired_tokens_do_not_verify() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let token = mgr
        .issue_token("alice", uid, TokenKind::Access, None, None, Some(0))
        .await
        .expect("issue");

    assert!(mgr
        .verify_token(&token.plaintext, TokenKind::Access)
        .await
        .is_none());
}

#[tokio::test]
async fn revokes_tokens_for_one_user_only() {
    let (mgr, _dir) = manager().await;
    let alice = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");
    let bob = mgr
        .create_user("bob", None, Some("pw"), false, false)
        .await
        .expect("create");

    let alice_token = mgr
        .issue_token("alice", alice, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");
    let bob_token = mgr
        .issue_token("bob", bob, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");

    mgr.revoke_tokens_for_user("alice", None).await.expect("revoke");

    assert!(mgr
        .verify_token(&alice_token.plaintext, TokenKind::Access)
        .await
        .is_none());
    assert!(
        mgr.verify_token(&bob_token.plaintext, TokenKind::Access)
            .await
            .is_some(),
        "revoking one user's tokens must not affect another's"
    );
}

#[tokio::test]
async fn lists_only_the_owners_personal_tokens() {
    let (mgr, _dir) = manager().await;
    let alice = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");
    let bob = mgr
        .create_user("bob", None, Some("pw"), false, false)
        .await
        .expect("create");

    mgr.issue_token("alice", alice, TokenKind::Personal, Some("ci".into()), None, None)
        .await
        .expect("issue");
    mgr.issue_token("alice", alice, TokenKind::Access, None, None, Some(60))
        .await
        .expect("issue");
    mgr.issue_token("bob", bob, TokenKind::Personal, Some("bobs".into()), None, None)
        .await
        .expect("issue");

    let listed = mgr
        .list_tokens("alice", TokenKind::Personal)
        .await
        .expect("list");
    assert_eq!(listed.len(), 1, "only alice's personal tokens");
    assert_eq!(listed[0].label.as_deref(), Some("ci"));
}

#[tokio::test]
async fn prunes_expired_tokens_and_keeps_live_ones() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    mgr.issue_token("alice", uid, TokenKind::Access, None, None, Some(0))
        .await
        .expect("issue");
    let live = mgr
        .issue_token("alice", uid, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");

    assert_eq!(mgr.prune_expired_tokens().await.expect("prune"), 1);
    assert!(mgr
        .verify_token(&live.plaintext, TokenKind::Access)
        .await
        .is_some());
}

#[tokio::test]
async fn admin_and_password_change_flags_round_trip() {
    let (mgr, _dir) = manager().await;
    mgr.create_user("root", None, Some("pw"), true, true)
        .await
        .expect("create");

    let user = mgr
        .get_user(UserIdentifier::Username("root".into()))
        .await
        .expect("user");
    assert!(user.is_admin);
    assert!(user.must_change_password);

    mgr.set_admin("root", false).await.expect("demote");
    mgr.require_password_change("root").await.expect("flag");

    let user = mgr
        .get_user(UserIdentifier::Username("root".into()))
        .await
        .expect("user");
    assert!(!user.is_admin);
    assert!(user.must_change_password);
}

#[tokio::test]
async fn lists_and_counts_users() {
    let (mgr, _dir) = manager().await;
    assert_eq!(mgr.count_users().await.expect("count"), 0);

    mgr.create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");
    mgr.create_user("bob", None, Some("pw"), false, false)
        .await
        .expect("create");

    assert_eq!(mgr.count_users().await.expect("count"), 2);
    let names: Vec<String> = mgr
        .list_users()
        .await
        .expect("list")
        .into_iter()
        .map(|u| u.username)
        .collect();
    assert!(names.contains(&"alice".to_string()));
    assert!(names.contains(&"bob".to_string()));
}
