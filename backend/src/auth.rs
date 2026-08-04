//! Authentication: opaque bearer tokens, and the extractor that turns one into a
//! `RequestUser`.
//!
//! # Why opaque tokens rather than the JWTs described in `auth.md`
//!
//! This is a single-process server backed by files on disk. The one thing a signed JWT
//! buys — verification without touching storage — is worthless here, while its cost
//! (revocation needs a denylist, which is a storage lookup anyway) is real. Opaque
//! tokens are revocable by construction.
//!
//! # Token format
//!
//! `mdb_<kind>_<id>.<secret>` — for example `mdb_at_7.QSdD...`. The id makes lookup
//! O(1); the secret is 32 CSPRNG bytes.
//!
//! Only `SHA-256(secret)` is persisted. SHA-256 is the right choice *here* and would be
//! wrong for a password: it is fast, but the secret has 256 bits of entropy, so there is
//! no dictionary to run and nothing for a slow hash to buy. Argon2 stays on passwords,
//! where the input is low-entropy and human-chosen. Verifying a token must be cheap
//! because it happens on every single request — the pre-existing
//! `verify_service_key`/`verify_and_consume_refresh_token` helpers ran a full Argon2
//! comparison against *every* stored row, which is why they are not used on this path.

use base64::Engine;
use password_hash::rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// How long an access token stays valid. Refresh tokens outlive them so a client can
/// bootstrap a new session without re-entering a password.
pub const ACCESS_TOKEN_TTL_SECS: u64 = 60 * 60 * 12;
pub const REFRESH_TOKEN_TTL_SECS: u64 = 60 * 60 * 24 * 30;

/// What a token authorizes. Personal access tokens are the "create one once you're
/// logged in" case: they act as the issuing user and carry that user's permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TokenKind {
    Access,
    Refresh,
    Personal,
}

impl TokenKind {
    pub fn prefix(&self) -> &'static str {
        match self {
            TokenKind::Access => "at",
            TokenKind::Refresh => "rt",
            TokenKind::Personal => "pat",
        }
    }

    pub fn from_prefix(prefix: &str) -> Option<Self> {
        match prefix {
            "at" => Some(TokenKind::Access),
            "rt" => Some(TokenKind::Refresh),
            "pat" => Some(TokenKind::Personal),
            _ => None,
        }
    }
}

/// Separator between a bot's owner and its generated suffix, e.g.
/// `admin--long_cat_fat`.
///
/// Usernames reject both `--` and `:`, so the two namespaces cannot overlap. Without a
/// reserved marker a token named `admin` would match every ACL entry granting `admin`,
/// which is a privilege escalation rather than a naming collision.
pub const BOT_IDENTITY_SEPARATOR: &str = "--";

/// Words used to build the generated suffix. Deliberately short and unambiguous so the
/// resulting identity is easy to read aloud and to paste into an ACL.
const BOT_WORDS: &[&str] = &[
    "long", "cat", "fat", "blue", "swift", "quiet", "brave", "tiny", "odd", "warm",
    "sharp", "loud", "calm", "bold", "dark", "fair", "keen", "lucky", "merry", "neat",
    "proud", "rapid", "sly", "tall", "vast", "wild", "young", "zesty", "amber", "brisk",
    "clever", "dizzy", "eager", "fuzzy", "glad", "happy", "icy", "jolly", "kind", "lively",
    "fox", "owl", "bear", "wolf", "hawk", "mole", "newt", "crow", "lynx", "toad",
    "otter", "raven", "shark", "tiger", "viper", "whale", "yak", "zebra", "finch", "gecko",
];

/// Environment variable that pins the generated suffix, for tests.
///
/// Set `MD_BUG_BOT_SUFFIX=fixed_test_bot` and every token becomes
/// `<owner>--fixed_test_bot`, so screenshots and assertions are reproducible without
/// scrubbing the name out afterwards. Only the *name* is fixable — the token secret is
/// always CSPRNG, because a predictable secret would be a real vulnerability if this were
/// ever set outside a test.
pub const BOT_SUFFIX_ENV: &str = "MD_BUG_BOT_SUFFIX";

/// Builds a bot identity of the form `<owner>--<word>_<word>_<word>`.
///
/// Names are generated rather than user-supplied: a human-chosen label is the thing most
/// likely to collide with, or be mistaken for, a real account.
pub fn generate_bot_identity(owner_username: &str) -> String {
    if let Ok(fixed) = std::env::var(BOT_SUFFIX_ENV) {
        if !fixed.is_empty() {
            return format!("{owner_username}{BOT_IDENTITY_SEPARATOR}{fixed}");
        }
    }
    let mut bytes = [0u8; 3];
    OsRng.fill_bytes(&mut bytes);
    let words: Vec<&str> = bytes
        .iter()
        .map(|b| BOT_WORDS[*b as usize % BOT_WORDS.len()])
        .collect();
    format!(
        "{owner_username}{BOT_IDENTITY_SEPARATOR}{}_{}_{}",
        words[0], words[1], words[2]
    )
}

/// True when a name belongs to the bot namespace rather than a real account.
///
/// Relies on usernames forbidding `--`; see `create_user`'s validation.
pub fn is_bot_identity(identity: &str) -> bool {
    identity.contains(BOT_IDENTITY_SEPARATOR)
}

/// A stored token. The plaintext secret exists only in the response that created it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredToken {
    pub id: u64,
    pub kind: TokenKind,
    /// The ACL identity. Deliberately the username and not the uid: permissions on disk
    /// are recorded as username strings inside rkyv blobs.
    pub username: String,
    pub uid: u64,
    /// Human-readable label, for personal access tokens shown in a management UI.
    pub label: Option<String>,
    /// The ACL name this token acts as, e.g. `bot:ci-agent`.
    ///
    /// Personal access tokens are separate identities: they can be added to component
    /// groups and bug access lists exactly like a user, and are capped at their owner's
    /// permissions. `None` means "act as the owner" — that is how access and refresh
    /// tokens work, and how personal tokens issued before identities existed behave.
    #[serde(default)]
    pub identity: Option<String>,
    pub secret_hash: String,
    /// Epoch seconds. `None` means the token does not expire on its own.
    pub expires_at: Option<u64>,
    pub created_at: u64,
}

impl StoredToken {
    pub fn is_expired(&self, now_secs: u64) -> bool {
        match self.expires_at {
            Some(expiry) => now_secs >= expiry,
            None => false,
        }
    }
}

/// The authenticated caller, produced by the extractor and passed to every handler.
#[derive(Debug, Clone)]
pub struct RequestUser {
    /// The name permission checks are made against. For a bot this is its `bot:` identity,
    /// not the owner's username.
    pub username: String,
    /// The human account behind the request. Equal to `username` for a real user; for a
    /// bot, the account that created the token.
    ///
    /// Every permission decision is capped by what this account can do, so a bot can be
    /// granted less than its owner but never more — and loses access automatically if the
    /// owner is demoted.
    pub owner_username: String,
    pub uid: u64,
    pub is_admin: bool,
    /// True when authenticating with a personal access token rather than a session.
    pub via_personal_token: bool,
}

impl RequestUser {
    /// True when this request is a bot acting under a personal access token.
    pub fn is_bot(&self) -> bool {
        self.via_personal_token && self.username != self.owner_username
    }
}

/// A freshly minted token: the plaintext to hand back, and the record to persist.
pub struct NewToken {
    pub plaintext: String,
    pub stored: StoredToken,
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 32 CSPRNG bytes, URL-safe base64, no padding.
pub fn generate_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn hash_secret(secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Constant-time comparison, so verification cannot be turned into an oracle by timing
/// how far two hashes match.
fn secrets_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[allow(clippy::too_many_arguments)]
pub fn build_token(
    id: u64,
    kind: TokenKind,
    username: &str,
    uid: u64,
    label: Option<String>,
    identity: Option<String>,
    ttl_secs: Option<u64>,
) -> NewToken {
    let secret = generate_secret();
    let now = now_secs();
    NewToken {
        plaintext: format!("mdb_{}_{}.{}", kind.prefix(), id, secret),
        stored: StoredToken {
            id,
            kind,
            username: username.to_string(),
            uid,
            label,
            identity,
            secret_hash: hash_secret(&secret),
            expires_at: ttl_secs.map(|ttl| now + ttl),
            created_at: now,
        },
    }
}

/// Splits `mdb_<kind>_<id>.<secret>` into its parts. Returns `None` on anything
/// malformed rather than guessing.
pub fn parse_token(token: &str) -> Option<(TokenKind, u64, String)> {
    let body = token.strip_prefix("mdb_")?;
    let (meta, secret) = body.split_once('.')?;
    let (prefix, id) = meta.rsplit_once('_')?;
    let kind = TokenKind::from_prefix(prefix)?;
    let id = id.parse::<u64>().ok()?;
    if secret.is_empty() {
        return None;
    }
    Some((kind, id, secret.to_string()))
}

/// Confirms a presented secret matches a stored record and that it has not expired.
pub fn verify_stored(stored: &StoredToken, presented_secret: &str, now: u64) -> bool {
    if stored.is_expired(now) {
        return false;
    }
    secrets_match(&stored.secret_hash, &hash_secret(presented_secret))
}

/// Pulls the bearer token out of an `Authorization` header.
pub fn bearer_from_header(header: Option<&str>) -> Option<String> {
    let value = header?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

#[cfg(test)]
#[path = "auth_test.rs"]
mod auth_test;
