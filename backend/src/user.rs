use nanodb::nanodb::NanoDB;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use password_hash::rand_core::OsRng;

use crate::auth::{self, NewToken, StoredToken, TokenKind};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub uid: u64,
    pub username: String,
    pub firebase_uid: Option<String>,
    pub password_hash: Option<String>,
    /// Admins may create and list users. Everything else is governed by the per-component
    /// ACLs, which are keyed on `username`.
    #[serde(default)]
    pub is_admin: bool,
    /// Set on the bootstrapped admin (whose password is machine-generated) and on any
    /// account an admin creates a password for. While true, the API rejects everything
    /// except changing the password and logging out.
    #[serde(default)]
    pub must_change_password: bool,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct UserDb {
    users: Vec<User>,
    /// Access, refresh and personal access tokens, keyed by id for O(1) lookup.
    #[serde(default)]
    tokens: Vec<StoredToken>,
    last_uid: u64,
    #[serde(default)]
    last_token_id: u64,
}

pub enum UserIdentifier {
    Uid(u64),
    FirebaseUid(String),
    Username(String),
}

pub struct UserManager {
    db: Arc<RwLock<NanoDB>>,
}

impl UserManager {
    pub async fn new(path: &std::path::Path) -> anyhow::Result<Self> {
        let mut db = NanoDB::open(path.to_str().unwrap_or("users.json"))?;
        
        // Initialize if empty
        if db.data().await.get("data").is_err() {
            db.insert("data", UserDb::default()).await?;
            db.write().await?;
        }

        Ok(Self {
            db: Arc::new(RwLock::new(db)),
        })
    }

    // --- User Management ---

    pub async fn has_username(&self, username: &str) -> bool {
        let db = self.db.read().await;
        if let Ok(tree) = db.data().await.get("data") {
            if let Ok(data) = tree.into::<UserDb>() {
                return data.users.iter().any(|u| u.username == username);
            }
        }
        false
    }

    pub async fn has_uid(&self, uid: u64) -> bool {
        let db = self.db.read().await;
        if let Ok(tree) = db.data().await.get("data") {
            if let Ok(data) = tree.into::<UserDb>() {
                return data.users.iter().any(|u| u.uid == uid);
            }
        }
        false
    }

    pub async fn has_firebase_uid(&self, firebase_uid: &str) -> bool {
        let db = self.db.read().await;
        if let Ok(tree) = db.data().await.get("data") {
            if let Ok(data) = tree.into::<UserDb>() {
                return data.users.iter().any(|u| u.firebase_uid.as_deref() == Some(firebase_uid));
            }
        }
        false
    }

    pub async fn get_user(&self, identifier: UserIdentifier) -> Option<User> {
        let db = self.db.read().await;
        if let Ok(tree) = db.data().await.get("data") {
            if let Ok(data) = tree.into::<UserDb>() {
                return match identifier {
                    UserIdentifier::Uid(uid) => data.users.iter().find(|u| u.uid == uid).cloned(),
                    UserIdentifier::FirebaseUid(fuid) => data.users.iter().find(|u| u.firebase_uid.as_deref() == Some(fuid.as_str())).cloned(),
                    UserIdentifier::Username(uname) => data.users.iter().find(|u| u.username == uname).cloned(),
                };
            }
        }
        None
    }

    /// Creates a user. `must_change_password` should be set whenever the caller — rather
    /// than the account holder — chose the password, so the holder is forced to replace
    /// it before the account can be used for anything else.
    pub async fn create_user(
        &self,
        username: &str,
        firebase_uid: Option<String>,
        password: Option<&str>,
        is_admin: bool,
        must_change_password: bool,
    ) -> anyhow::Result<u64> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;
        
        // Check for duplicates
        if data.users.iter().any(|u| u.username == username) {
            anyhow::bail!("Username already exists");
        }
        if let Some(ref fuid) = firebase_uid {
            if data.users.iter().any(|u| u.firebase_uid.as_deref() == Some(fuid.as_str())) {
                anyhow::bail!("Firebase UID already exists");
            }
        }

        let password_hash = if let Some(pass) = password {
            let salt = SaltString::generate(&mut OsRng);
            let argon2 = Argon2::default();
            Some(argon2.hash_password(pass.as_bytes(), &salt).map_err(|e| anyhow::anyhow!(e))?.to_string())
        } else {
            None
        };

        data.last_uid += 1;
        let new_uid = data.last_uid;
        
        data.users.push(User {
            uid: new_uid,
            username: username.to_string(),
            firebase_uid,
            password_hash,
            is_admin,
            must_change_password,
        });

        db.insert("data", data).await?;
        db.write().await?;
        
        Ok(new_uid)
    }

    pub async fn verify_password(&self, username: &str, password: &str) -> anyhow::Result<u64> {
        let user = self.get_user(UserIdentifier::Username(username.to_string())).await
            .ok_or_else(|| anyhow::anyhow!("User not found"))?;
        
        let hash_str = user.password_hash.ok_or_else(|| anyhow::anyhow!("User has no password set"))?;
        let parsed_hash = PasswordHash::new(&hash_str).map_err(|e| anyhow::anyhow!(e))?;
        
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .map_err(|_| anyhow::anyhow!("Invalid password"))?;
        
        Ok(user.uid)
    }

    /// Replaces a user's password and clears the forced-rotation flag.
    pub async fn set_password(&self, username: &str, password: &str) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let user = data
            .users
            .iter_mut()
            .find(|u| u.username == username)
            .ok_or_else(|| anyhow::anyhow!("User not found"))?;

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        user.password_hash = Some(
            argon2
                .hash_password(password.as_bytes(), &salt)
                .map_err(|e| anyhow::anyhow!(e))?
                .to_string(),
        );
        user.must_change_password = false;

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    pub async fn set_admin(&self, username: &str, is_admin: bool) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let user = data
            .users
            .iter_mut()
            .find(|u| u.username == username)
            .ok_or_else(|| anyhow::anyhow!("User not found"))?;
        user.is_admin = is_admin;

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    /// Marks an account as needing a password rotation before it can do anything else.
    pub async fn require_password_change(&self, username: &str) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let user = data
            .users
            .iter_mut()
            .find(|u| u.username == username)
            .ok_or_else(|| anyhow::anyhow!("User not found"))?;
        user.must_change_password = true;

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    pub async fn list_users(&self) -> anyhow::Result<Vec<User>> {
        let db = self.db.read().await;
        let tree = db.data().await.get("data")?;
        Ok(tree.into::<UserDb>()?.users)
    }

    pub async fn count_users(&self) -> anyhow::Result<usize> {
        Ok(self.list_users().await?.len())
    }

    // --- Token Management ---
    //
    // Tokens are looked up by id, so verification is a single indexed comparison rather
    // than an Argon2 pass over every stored row. See `auth.rs` for why SHA-256 is the
    // right hash for a 256-bit random secret.

    /// Mints a token for `username` and persists its hash. The returned plaintext is the
    /// only time the caller can ever see it.
    pub async fn issue_token(
        &self,
        username: &str,
        uid: u64,
        kind: TokenKind,
        label: Option<String>,
        ttl_secs: Option<u64>,
    ) -> anyhow::Result<NewToken> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        data.last_token_id += 1;
        let token = auth::build_token(data.last_token_id, kind, username, uid, label, ttl_secs);
        data.tokens.push(token.stored.clone());

        db.insert("data", data).await?;
        db.write().await?;
        Ok(token)
    }

    /// Resolves a presented token string to its stored record, or `None` if it is
    /// malformed, unknown, expired, or the secret does not match.
    pub async fn verify_token(&self, presented: &str, expected: TokenKind) -> Option<StoredToken> {
        let (kind, id, secret) = auth::parse_token(presented)?;
        if kind != expected {
            return None;
        }

        let db = self.db.read().await;
        let data = db.data().await.get("data").ok()?.into::<UserDb>().ok()?;
        let stored = data.tokens.iter().find(|t| t.id == id && t.kind == kind)?;

        if auth::verify_stored(stored, &secret, auth::now_secs()) {
            Some(stored.clone())
        } else {
            None
        }
    }

    /// Single-use consumption for refresh-token rotation: verifies, then deletes.
    pub async fn consume_token(&self, presented: &str, expected: TokenKind) -> Option<StoredToken> {
        let stored = self.verify_token(presented, expected).await?;
        self.revoke_token(stored.id).await.ok()?;
        Some(stored)
    }

    pub async fn revoke_token(&self, token_id: u64) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        data.tokens.retain(|t| t.id != token_id);

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    /// Revokes every token for a user, optionally limited to one kind. Used by logout
    /// and after a password change.
    pub async fn revoke_tokens_for_user(
        &self,
        username: &str,
        kind: Option<TokenKind>,
    ) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        data.tokens.retain(|t| {
            let same_user = t.username == username;
            let same_kind = kind.map(|k| t.kind == k).unwrap_or(true);
            !(same_user && same_kind)
        });

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    pub async fn list_tokens(&self, username: &str, kind: TokenKind) -> anyhow::Result<Vec<StoredToken>> {
        let db = self.db.read().await;
        let tree = db.data().await.get("data")?;
        let data = tree.into::<UserDb>()?;
        Ok(data
            .tokens
            .into_iter()
            .filter(|t| t.username == username && t.kind == kind)
            .collect())
    }

    /// Drops tokens that are already past their expiry.
    pub async fn prune_expired_tokens(&self) -> anyhow::Result<usize> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let now = auth::now_secs();
        let before = data.tokens.len();
        data.tokens.retain(|t| !t.is_expired(now));
        let removed = before - data.tokens.len();

        if removed > 0 {
            db.insert("data", data).await?;
            db.write().await?;
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod user_test;
