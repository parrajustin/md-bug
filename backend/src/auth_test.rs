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
    let token = build_token(7, TokenKind::Access, "alice", 1, None, Some(60));
    let (kind, id, secret) = parse_token(&token.plaintext).expect("should parse");

    assert_eq!(kind, TokenKind::Access);
    assert_eq!(id, 7);
    assert!(verify_stored(&token.stored, &secret, now_secs()));
}

#[test]
fn stores_only_the_hash_not_the_secret() {
    let token = build_token(1, TokenKind::Personal, "alice", 1, None, None);
    let (_, _, secret) = parse_token(&token.plaintext).expect("should parse");

    assert_ne!(token.stored.secret_hash, secret);
    assert!(!token.stored.secret_hash.contains(&secret));
    assert_eq!(token.stored.secret_hash, hash_secret(&secret));
}

#[test]
fn rejects_a_wrong_secret() {
    let token = build_token(3, TokenKind::Access, "alice", 1, None, Some(60));
    assert!(!verify_stored(&token.stored, "not-the-secret", now_secs()));
}

#[test]
fn rejects_an_expired_token() {
    let token = build_token(3, TokenKind::Access, "alice", 1, None, Some(60));
    let (_, _, secret) = parse_token(&token.plaintext).expect("should parse");

    assert!(verify_stored(&token.stored, &secret, now_secs()));
    assert!(
        !verify_stored(&token.stored, &secret, now_secs() + 61),
        "a token past its expiry must not verify"
    );
}

#[test]
fn personal_tokens_can_be_non_expiring() {
    let token = build_token(1, TokenKind::Personal, "alice", 1, Some("ci".into()), None);
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
    let access = build_token(1, TokenKind::Access, "alice", 1, None, Some(60));
    let personal = build_token(1, TokenKind::Personal, "alice", 1, None, None);

    assert!(access.plaintext.starts_with("mdb_at_"));
    assert!(personal.plaintext.starts_with("mdb_pat_"));

    let (kind, _, _) = parse_token(&personal.plaintext).expect("should parse");
    assert_eq!(kind, TokenKind::Personal);
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
