use super::*;

#[test]
fn generated_secrets_are_unique_and_long() {
    let a = generate_secret();
    let b = generate_secret();
    assert_ne!(a, b, "CSPRNG must not repeat across calls");
    // 32 bytes -> 43 base64url chars without padding.
    assert_eq!(a.len(), 43);
}

#[test]
fn round_trips_a_built_token() {
    let token = build_token(7, TokenKind::Access, "alice", 1, None, None, Some(60));
    let (kind, id, secret) = parse_token(&token.plaintext).expect("should parse");

    assert_eq!(kind, TokenKind::Access);
    assert_eq!(id, 7);
    assert!(verify_stored(&token.stored, &secret, now_secs()));
}

#[test]
fn stores_only_the_hash_not_the_secret() {
    let token = build_token(1, TokenKind::Bot, "alice", 1, None, None, None);
    let (_, _, secret) = parse_token(&token.plaintext).expect("should parse");

    assert_ne!(token.stored.secret_hash, secret);
    assert!(!token.stored.secret_hash.contains(&secret));
    assert_eq!(token.stored.secret_hash, hash_secret(&secret));
}

#[test]
fn rejects_a_wrong_secret() {
    let token = build_token(3, TokenKind::Access, "alice", 1, None, None, Some(60));
    assert!(!verify_stored(&token.stored, "not-the-secret", now_secs()));
}

#[test]
fn rejects_an_expired_token() {
    let token = build_token(3, TokenKind::Access, "alice", 1, None, None, Some(60));
    let (_, _, secret) = parse_token(&token.plaintext).expect("should parse");

    assert!(verify_stored(&token.stored, &secret, now_secs()));
    assert!(
        !verify_stored(&token.stored, &secret, now_secs() + 61),
        "a token past its expiry must not verify"
    );
}

#[test]
fn personal_tokens_can_be_non_expiring() {
    let token = build_token(1, TokenKind::Bot, "alice", 1, Some("ci".into()), None, None);
    assert_eq!(token.stored.expires_at, None);
    assert!(!token.stored.is_expired(now_secs() + 60 * 60 * 24 * 365 * 10));
}

#[test]
fn rejects_malformed_tokens() {
    for bad in [
        "",
        "garbage",
        "mdb_at_7",             // no secret
        "mdb_at_7.",            // empty secret
        "mdb_zz_7.abc",         // unknown kind
        "mdb_at_notanumber.abc", // non-numeric id
        "Bearer mdb_at_7.abc",  // scheme not stripped
    ] {
        assert!(parse_token(bad).is_none(), "should reject {bad:?}");
    }
}

#[test]
fn token_kinds_are_distinguishable() {
    let access = build_token(1, TokenKind::Access, "alice", 1, None, None, Some(60));
    let personal = build_token(1, TokenKind::Bot, "alice", 1, None, None, None);

    assert!(access.plaintext.starts_with("mdb_at_"));
    assert!(personal.plaintext.starts_with("mdb_bot_"));

    let (kind, _, _) = parse_token(&personal.plaintext).expect("should parse");
    assert_eq!(kind, TokenKind::Bot);
}

#[test]
fn extracts_bearer_headers_case_insensitively() {
    assert_eq!(bearer_from_header(Some("Bearer abc")), Some("abc".into()));
    assert_eq!(bearer_from_header(Some("bearer abc")), Some("abc".into()));
    assert_eq!(bearer_from_header(Some("BEARER abc")), Some("abc".into()));
}

#[test]
fn rejects_non_bearer_authorization() {
    assert_eq!(bearer_from_header(None), None);
    assert_eq!(bearer_from_header(Some("Basic abc")), None);
    assert_eq!(bearer_from_header(Some("abc")), None);
    assert_eq!(bearer_from_header(Some("Bearer ")), None);
}

#[test]
fn bot_suffix_can_be_pinned_for_tests() {
    // Serialised implicitly: this is the only test touching the variable.
    unsafe { std::env::set_var(BOT_SUFFIX_ENV, "fixed_test_bot") };
    assert_eq!(generate_bot_identity("admin"), "admin--fixed_test_bot");
    assert_eq!(generate_bot_identity("alice"), "alice--fixed_test_bot");

    // An empty value must not pin anything, or a stray export would freeze every name.
    unsafe { std::env::set_var(BOT_SUFFIX_ENV, "") };
    assert_ne!(generate_bot_identity("admin"), "admin--");

    unsafe { std::env::remove_var(BOT_SUFFIX_ENV) };
    assert!(is_bot_identity(&generate_bot_identity("admin")));
}

#[test]
fn api_and_bot_tokens_are_distinct_kinds() {
    // These are easy to conflate, so pin the difference: an API token carries no ACL
    // identity because it *is* the user; a bot token carries one because it is not.
    let api = build_token(1, TokenKind::Api, "alice", 1, Some("long_cat_fat".into()), None, None);
    let bot = build_token(
        2,
        TokenKind::Bot,
        "alice",
        1,
        Some("alice--long_cat_fat".into()),
        Some("alice--long_cat_fat".into()),
        None,
    );

    assert!(api.plaintext.starts_with("mdb_api_"));
    assert!(bot.plaintext.starts_with("mdb_bot_"));
    assert_eq!(api.stored.identity, None);
    assert_eq!(bot.stored.identity.as_deref(), Some("alice--long_cat_fat"));

    // Neither may be presented where the other is expected.
    let (api_kind, _, _) = parse_token(&api.plaintext).expect("parse");
    let (bot_kind, _, _) = parse_token(&bot.plaintext).expect("parse");
    assert_eq!(api_kind, TokenKind::Api);
    assert_eq!(bot_kind, TokenKind::Bot);

    assert!(TokenKind::Api.is_long_lived());
    assert!(TokenKind::Bot.is_long_lived());
    assert!(!TokenKind::Access.is_long_lived());
    assert!(!TokenKind::Refresh.is_long_lived());
}

#[test]
fn api_token_labels_carry_no_owner_prefix() {
    // A label is not an ACL name, so it must not look like a bot identity.
    let label = generate_token_label();
    assert_eq!(label.split('_').count(), 3, "expected three words: {label}");
    assert!(!is_bot_identity(&label), "a label must not read as a bot identity");
}
