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

    mgr.issue_token("alice", alice, TokenKind::Bot, Some("ci".into()), None, None)
        .await
        .expect("issue");
    mgr.issue_token("alice", alice, TokenKind::Access, None, None, Some(60))
        .await
        .expect("issue");
    mgr.issue_token("bob", bob, TokenKind::Bot, Some("bobs".into()), None, None)
        .await
        .expect("issue");

    let listed = mgr
        .list_tokens("alice", TokenKind::Bot)
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

#[tokio::test]
async fn an_admin_created_account_must_rotate_before_use() {
    let (mgr, _dir) = manager().await;

    // Mirrors what the create-user endpoint does: a generated password, flagged for
    // replacement because someone other than the holder has seen it.
    let generated = crate::auth::generate_secret();
    mgr.create_user("newbie", None, Some(&generated), false, true)
        .await
        .expect("create");

    let user = mgr
        .get_user(UserIdentifier::Username("newbie".into()))
        .await
        .expect("user");
    assert!(
        user.must_change_password,
        "an account whose password an admin has seen must be forced to rotate"
    );

    // The generated password works for the login that leads to the rotation screen.
    assert!(mgr.verify_password("newbie", &generated).await.is_ok());

    // After rotating, the flag clears and the generated one stops working.
    mgr.set_password("newbie", "chosen-by-the-holder")
        .await
        .expect("rotate");
    let user = mgr
        .get_user(UserIdentifier::Username("newbie".into()))
        .await
        .expect("user");
    assert!(!user.must_change_password);
    assert!(mgr.verify_password("newbie", &generated).await.is_err());
    assert!(mgr.verify_password("newbie", "chosen-by-the-holder").await.is_ok());
}

#[tokio::test]
async fn generated_passwords_differ_between_accounts() {
    let (mgr, _dir) = manager().await;

    let first = crate::auth::generate_secret();
    let second = crate::auth::generate_secret();
    assert_ne!(first, second, "each account must get its own password");

    mgr.create_user("a", None, Some(&first), false, true).await.expect("a");
    mgr.create_user("b", None, Some(&second), false, true).await.expect("b");

    // One account's password must not open another.
    assert!(mgr.verify_password("a", &second).await.is_err());
    assert!(mgr.verify_password("b", &first).await.is_err());
}

#[tokio::test]
async fn disabling_an_account_revokes_its_tokens_immediately() {
    let (mgr, _dir) = manager().await;
    let uid = mgr
        .create_user("alice", None, Some("pw"), false, false)
        .await
        .expect("create");

    let session = mgr
        .issue_token("alice", uid, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");
    let api = mgr
        .issue_token("alice", uid, TokenKind::Api, None, None, None)
        .await
        .expect("issue");

    assert!(mgr.verify_token(&session.plaintext, TokenKind::Access).await.is_some());

    mgr.set_disabled("alice", true).await.expect("disable");

    let user = mgr
        .get_user(UserIdentifier::Username("alice".into()))
        .await
        .expect("user");
    assert!(user.disabled);
    // Waiting for expiry would leave a disabled account working for hours.
    assert!(
        mgr.verify_token(&session.plaintext, TokenKind::Access).await.is_none(),
        "disabling must kill live sessions, not just block new logins"
    );
    assert!(
        mgr.verify_token(&api.plaintext, TokenKind::Api).await.is_none(),
        "and long-lived API tokens too"
    );
}

#[tokio::test]
async fn disabling_leaves_other_accounts_alone() {
    let (mgr, _dir) = manager().await;
    let alice = mgr.create_user("alice", None, Some("pw"), false, false).await.expect("a");
    let bob = mgr.create_user("bob", None, Some("pw"), false, false).await.expect("b");

    let alice_token = mgr
        .issue_token("alice", alice, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");
    let bob_token = mgr
        .issue_token("bob", bob, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");

    mgr.set_disabled("alice", true).await.expect("disable");

    assert!(mgr.verify_token(&alice_token.plaintext, TokenKind::Access).await.is_none());
    assert!(mgr.verify_token(&bob_token.plaintext, TokenKind::Access).await.is_some());
    let bob_user = mgr
        .get_user(UserIdentifier::Username("bob".into()))
        .await
        .expect("user");
    assert!(!bob_user.disabled);
}

#[tokio::test]
async fn a_disabled_account_can_be_re_enabled() {
    let (mgr, _dir) = manager().await;
    mgr.create_user("alice", None, Some("pw"), false, false).await.expect("create");

    mgr.set_disabled("alice", true).await.expect("disable");
    mgr.set_disabled("alice", false).await.expect("enable");

    let user = mgr
        .get_user(UserIdentifier::Username("alice".into()))
        .await
        .expect("user");
    assert!(!user.disabled);
    // The password still works; disabling is not a password reset.
    assert!(mgr.verify_password("alice", "pw").await.is_ok());
}

#[tokio::test]
async fn lists_every_token_across_all_users() {
    let (mgr, _dir) = manager().await;
    let alice = mgr.create_user("alice", None, Some("pw"), false, false).await.expect("a");
    let bob = mgr.create_user("bob", None, Some("pw"), false, false).await.expect("b");

    mgr.issue_token("alice", alice, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("session");
    mgr.issue_token("alice", alice, TokenKind::Api, Some("cat_fox_owl".into()), None, None)
        .await
        .expect("api");
    mgr.issue_token(
        "bob",
        bob,
        TokenKind::Bot,
        Some("bob--cat_fox_owl".into()),
        Some("bob--cat_fox_owl".into()),
        None,
    )
    .await
    .expect("bot");

    let all = mgr.list_all_tokens().await.expect("list");
    assert_eq!(all.len(), 3, "the admin view spans every account, not just one");

    // Secrets are only ever stored hashed, so surfacing this list reveals no credential.
    for token in &all {
        assert_eq!(token.secret_hash.len(), 64, "expected a SHA-256 hex digest");
    }

    let owners: Vec<&str> = all.iter().map(|t| t.username.as_str()).collect();
    assert!(owners.contains(&"alice"));
    assert!(owners.contains(&"bob"));
}

#[tokio::test]
async fn an_admin_can_revoke_someone_elses_session() {
    let (mgr, _dir) = manager().await;
    let bob = mgr.create_user("bob", None, Some("pw"), false, false).await.expect("b");

    let session = mgr
        .issue_token("bob", bob, TokenKind::Access, None, None, Some(3600))
        .await
        .expect("issue");
    assert!(mgr.verify_token(&session.plaintext, TokenKind::Access).await.is_some());

    // Cutting off a compromised session belonging to someone else is the point of the
    // admin console, so this path deliberately ignores ownership.
    let id = mgr.list_all_tokens().await.expect("list")[0].id;
    mgr.revoke_token(id).await.expect("revoke");

    assert!(mgr.verify_token(&session.plaintext, TokenKind::Access).await.is_none());
}
