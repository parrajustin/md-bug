//! HTTP handlers for `/api/auth/*`.
//!
//! These are the only routes that do not require a valid access token — otherwise there
//! would be no way to obtain one. Each decides for itself what credential it accepts.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api::{AppState, RequestUser};
use crate::auth::{TokenKind, ACCESS_TOKEN_TTL_SECS, REFRESH_TOKEN_TTL_SECS};
use crate::user::UserIdentifier;

/// Minimum password length. Deliberately modest — the real protection is Argon2 plus
/// the fact that accounts are admin-provisioned, not open to the internet.
const MIN_PASSWORD_LEN: usize = 8;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub username: String,
    pub is_admin: bool,
    /// When true the client must call `/api/auth/change_password` before anything else
    /// will work; every other endpoint returns 403 until it does.
    pub must_change_password: bool,
    pub expires_in: u64,
}

/// `POST /api/auth/login` — exchange a username and password for a token pair.
///
/// A bad username and a bad password return the same 401 so the endpoint cannot be used
/// to enumerate accounts.
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let uid = state
        .users
        .verify_password(&payload.username, &payload.password)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let user = state
        .users
        .get_user(UserIdentifier::Uid(uid))
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let access = state
        .users
        .issue_token(
            &user.username,
            uid,
            TokenKind::Access,
            None,
            None,
            Some(ACCESS_TOKEN_TTL_SECS),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh = state
        .users
        .issue_token(
            &user.username,
            uid,
            TokenKind::Refresh,
            None,
            None,
            Some(REFRESH_TOKEN_TTL_SECS),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(LoginResponse {
        access_token: access.plaintext,
        refresh_token: refresh.plaintext,
        username: user.username,
        is_admin: user.is_admin,
        must_change_password: user.must_change_password,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// `POST /api/auth/refresh` — trade a refresh token for a new pair.
///
/// The presented refresh token is consumed (rotation), so a stolen one is usable at most
/// once, and only until the legitimate client next refreshes.
pub async fn refresh(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RefreshRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let stored = state
        .users
        .consume_token(&payload.refresh_token, TokenKind::Refresh)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let user = state
        .users
        .get_user(UserIdentifier::Username(stored.username.clone()))
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let access = state
        .users
        .issue_token(
            &stored.username,
            stored.uid,
            TokenKind::Access,
            None,
            None,
            Some(ACCESS_TOKEN_TTL_SECS),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let new_refresh = state
        .users
        .issue_token(
            &stored.username,
            stored.uid,
            TokenKind::Refresh,
            None,
            None,
            Some(REFRESH_TOKEN_TTL_SECS),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(LoginResponse {
        access_token: access.plaintext,
        refresh_token: new_refresh.plaintext,
        username: user.username,
        is_admin: user.is_admin,
        must_change_password: user.must_change_password,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub username: String,
    pub current_password: String,
    pub new_password: String,
}

/// `POST /api/auth/change_password`.
///
/// Authenticated by the *current password* rather than a bearer token, precisely so an
/// account under forced rotation can use it — such accounts are refused by the
/// `RequestUser` extractor, which would otherwise make the flag inescapable.
///
/// Every existing token for the account is revoked afterwards: a password change should
/// evict sessions an attacker may already hold.
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if payload.new_password.len() < MIN_PASSWORD_LEN {
        return Err(StatusCode::BAD_REQUEST);
    }
    if payload.new_password == payload.current_password {
        return Err(StatusCode::BAD_REQUEST);
    }

    state
        .users
        .verify_password(&payload.username, &payload.current_password)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    state
        .users
        .set_password(&payload.username, &payload.new_password)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state
        .users
        .revoke_tokens_for_user(&payload.username, None)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/auth/logout` — revoke the caller's access and refresh tokens.
///
/// Personal access tokens survive: they represent long-lived automation, not the
/// interactive session being ended.
pub async fn logout(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    for kind in [TokenKind::Access, TokenKind::Refresh] {
        state
            .users
            .revoke_tokens_for_user(&user.owner_username, Some(kind))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct MeResponse {
    pub username: String,
    /// The human account behind the request; differs from `username` for a bot.
    pub owner_username: String,
    pub uid: u64,
    pub is_admin: bool,
    pub via_personal_token: bool,
    pub is_bot: bool,
}

/// `GET /api/auth/me` — who the presented token belongs to.
pub async fn me(user: RequestUser) -> impl IntoResponse {
    Json(MeResponse {
        username: user.username.clone(),
        owner_username: user.owner_username.clone(),
        uid: user.uid,
        is_admin: user.is_admin,
        via_personal_token: user.via_personal_token,
        is_bot: user.is_bot(),
    })
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub is_admin: bool,
}

#[derive(Serialize)]
pub struct CreateUserResponse {
    pub username: String,
    pub uid: u64,
}

/// `POST /api/auth/users` — admin-only account creation.
///
/// The new account is flagged `must_change_password`, because the admin chose the
/// password and therefore knows it.
pub async fn create_user(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
    Json(payload): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if !user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    if payload.username.trim().is_empty()
        || payload.username == "PUBLIC"
        || payload.username.contains(':')
        || payload.username.contains(crate::auth::BOT_IDENTITY_SEPARATOR)
    {
        // "PUBLIC" is the wildcard member in every ACL; a real account by that name
        // would silently inherit every grant in the system. ':' is reserved for the
        // bot namespace (`--`), so a username can never impersonate a token identity.
        return Err(StatusCode::BAD_REQUEST);
    }
    if payload.password.len() < MIN_PASSWORD_LEN {
        return Err(StatusCode::BAD_REQUEST);
    }

    let uid = state
        .users
        .create_user(
            &payload.username,
            None,
            Some(&payload.password),
            payload.is_admin,
            /*must_change_password=*/ true,
        )
        .await
        .map_err(|_| StatusCode::CONFLICT)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateUserResponse {
            username: payload.username,
            uid,
        }),
    ))
}

#[derive(Serialize)]
pub struct UserSummary {
    pub username: String,
    pub uid: u64,
    pub is_admin: bool,
    pub must_change_password: bool,
}

/// `GET /api/auth/users` — admin-only listing. Password hashes are never included.
pub async fn list_users(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    if !user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let users = state
        .users
        .list_users()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let summaries: Vec<UserSummary> = users
        .into_iter()
        .map(|u| UserSummary {
            username: u.username,
            uid: u.uid,
            is_admin: u.is_admin,
            must_change_password: u.must_change_password,
        })
        .collect();

    Ok(Json(summaries))
}

/// Token creation takes no input: the name is generated, so there is nothing to supply.
#[derive(Deserialize, Default)]
pub struct CreateTokenRequest {}

#[derive(Serialize)]
pub struct CreateTokenResponse {
    pub id: u64,
    pub label: String,
    /// The ACL name this token acts as, e.g. `bot:ci-agent`. Add this to component groups
    /// or bug access lists exactly as you would a username.
    pub identity: String,
    /// The only time the plaintext is ever returned. Nothing stores it.
    pub token: String,
}

/// `POST /api/auth/tokens` — mint a personal access token for the caller.
///
/// These do not expire and act as the issuing user, which is what makes them usable by
/// agents and CI. They are also why `logout` leaves them alone.
pub async fn create_personal_token(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
    Json(_payload): Json<CreateTokenRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    // A personal token cannot mint further tokens: that would let a leaked token renew
    // itself indefinitely even after the original was revoked.
    if user.via_personal_token {
        return Err(StatusCode::FORBIDDEN);
    }

    // Names are generated, not chosen. Retry on the (unlikely) chance of a collision —
    // an ACL entry has to refer to exactly one token.
    let mut identity = String::new();
    let mut found = false;
    for _ in 0..8 {
        let candidate = crate::auth::generate_bot_identity(&user.username);
        if !state.users.has_bot_identity(&candidate).await {
            identity = candidate;
            found = true;
            break;
        }
    }
    if !found {
        // Only reachable when the generator keeps producing a taken name — in practice
        // that means MD_BUG_BOT_SUFFIX pins it and a token already holds it. A conflict
        // is the honest answer; a 500 would suggest a server fault.
        return Err(StatusCode::CONFLICT);
    }

    let token = state
        .users
        .issue_token(
            &user.username,
            user.uid,
            TokenKind::Personal,
            Some(identity.clone()),
            Some(identity.clone()),
            None,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateTokenResponse {
            id: token.stored.id,
            label: identity.clone(),
            identity,
            token: token.plaintext,
        }),
    ))
}

#[derive(Serialize)]
pub struct TokenSummary {
    pub id: u64,
    pub label: Option<String>,
    /// The ACL name, so the UI can show what to paste into a component or bug.
    pub identity: Option<String>,
    pub created_at: u64,
}

/// `GET /api/auth/tokens` — list the caller's personal tokens, without their secrets.
pub async fn list_personal_tokens(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
) -> Result<impl IntoResponse, StatusCode> {
    let tokens = state
        .users
        .list_tokens(&user.owner_username, TokenKind::Personal)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let summaries: Vec<TokenSummary> = tokens
        .into_iter()
        .map(|t| TokenSummary {
            id: t.id,
            label: t.label,
            identity: t.identity,
            created_at: t.created_at,
        })
        .collect();

    Ok(Json(summaries))
}

/// `DELETE /api/auth/tokens/:id` — revoke one of the caller's personal tokens.
///
/// Ownership is checked before deletion, otherwise any authenticated user could revoke
/// anyone else's tokens by guessing ids.
pub async fn revoke_personal_token(
    State(state): State<Arc<AppState>>,
    user: RequestUser,
    Path(id): Path<u64>,
) -> Result<impl IntoResponse, StatusCode> {
    let tokens = state
        .users
        .list_tokens(&user.owner_username, TokenKind::Personal)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !tokens.iter().any(|t| t.id == id) {
        return Err(StatusCode::NOT_FOUND);
    }

    state
        .users
        .revoke_token(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::NO_CONTENT)
}
