use nanodb::nanodb::NanoDB;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use password_hash::rand_core::OsRng;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub uid: u64,
    pub username: String,
    pub firebase_uid: Option<String>,
    pub password_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceAccount {
    pub id: u64,
    pub name: String,
    pub key_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RefreshToken {
    pub token_hash: String,
    pub user_id: u64,
    pub is_service_account: bool,
    pub expires_at: u64, // Epoch nanoseconds
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct UserDb {
    users: Vec<User>,
    service_accounts: Vec<ServiceAccount>,
    refresh_tokens: Vec<RefreshToken>,
    last_uid: u64,
    last_sa_id: u64,
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

    pub async fn create_user(&self, username: &str, firebase_uid: Option<String>, password: Option<&str>) -> anyhow::Result<u64> {
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

    // --- Service Account Management ---

    pub async fn create_service_account(&self, name: &str, raw_key: &str) -> anyhow::Result<u64> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        if data.service_accounts.iter().any(|sa| sa.name == name) {
            anyhow::bail!("Service account name already exists");
        }

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let key_hash = argon2.hash_password(raw_key.as_bytes(), &salt).map_err(|e| anyhow::anyhow!(e))?.to_string();

        data.last_sa_id += 1;
        let id = data.last_sa_id;

        data.service_accounts.push(ServiceAccount {
            id,
            name: name.to_string(),
            key_hash,
        });

        db.insert("data", data).await?;
        db.write().await?;

        Ok(id)
    }

    pub async fn verify_service_key(&self, raw_key: &str) -> anyhow::Result<u64> {
        let db = self.db.read().await;
        let tree = db.data().await.get("data")?;
        let data = tree.into::<UserDb>()?;

        let argon2 = Argon2::default();
        for sa in &data.service_accounts {
            let parsed_hash = PasswordHash::new(&sa.key_hash).map_err(|e| anyhow::anyhow!(e))?;
            if argon2.verify_password(raw_key.as_bytes(), &parsed_hash).is_ok() {
                return Ok(sa.id);
            }
        }

        anyhow::bail!("Invalid service key")
    }

    // --- Token Management ---

    pub async fn add_refresh_token(&self, user_id: u64, is_service_account: bool, raw_token: &str, expires_at: u64) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let token_hash = argon2.hash_password(raw_token.as_bytes(), &salt).map_err(|e| anyhow::anyhow!(e))?.to_string();

        data.refresh_tokens.push(RefreshToken {
            token_hash,
            user_id,
            is_service_account,
            expires_at,
        });

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }

    pub async fn verify_and_consume_refresh_token(&self, raw_token: &str) -> anyhow::Result<(u64, bool)> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        let argon2 = Argon2::default();
        let mut found_index = None;

        for (i, rt) in data.refresh_tokens.iter().enumerate() {
            let parsed_hash = PasswordHash::new(&rt.token_hash).map_err(|e| anyhow::anyhow!(e))?;
            if argon2.verify_password(raw_token.as_bytes(), &parsed_hash).is_ok() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_nanos() as u64;
                
                if rt.expires_at < now {
                    found_index = Some(i); // Mark for deletion anyway
                    break;
                }
                
                let res = (rt.user_id, rt.is_service_account);
                data.refresh_tokens.remove(i);
                db.insert("data", data).await?;
                db.write().await?;
                return Ok(res);
            }
        }

        if let Some(i) = found_index {
            data.refresh_tokens.remove(i);
            db.insert("data", data).await?;
            db.write().await?;
            anyhow::bail!("Token expired");
        }

        anyhow::bail!("Invalid token")
    }

    pub async fn revoke_all_tokens(&self, user_id: u64, is_service_account: bool) -> anyhow::Result<()> {
        let mut db = self.db.write().await;
        let tree = db.data().await.get("data")?;
        let mut data = tree.into::<UserDb>()?;

        data.refresh_tokens.retain(|rt| rt.user_id != user_id || rt.is_service_account != is_service_account);

        db.insert("data", data).await?;
        db.write().await?;
        Ok(())
    }
}

#[cfg(test)]
mod user_test;
