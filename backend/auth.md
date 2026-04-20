# Authentication & Token Management Research

This document Distills best practices for implementing a secure, hybrid authentication system in Rust (Axum). It unifies external identity providers (Firebase) and internal credentials (Native/Service Accounts) into a single, local session management system.

## 1. Unified Local Session Model

Regardless of how a user or agent authenticates, the result is always a **Local Issue Tracker Token pair**. This decouples the issue tracker's API security from external providers.

- **Internal Access Token**: A short-lived JWT (15-60 min) signed by the backend. This is the **only** token accepted by the core bug/component APIs.
- **Internal Refresh Token**: A long-lived, high-entropy random string (7+ days) stored in the database. Used to "bootstrap" a new session each day.

### The Bootstrap Concept
External tokens (like Firebase ID Tokens) are treated as **transient proof of identity**. We validate them once to identify the user, then immediately discard them and issue our own local tokens.

---

## 2. Authentication Flows & HTTP APIs

The backend must expose specific endpoints to handle the "Exchange" of credentials for local tokens.

### A. Firebase Login Flow
1.  **Frontend**: Obtains a `FirebaseIdToken` from Google/Firebase SDK.
2.  **Request**: `POST /api/auth/login/firebase { "token": "..." }`
3.  **Backend**:
    - Fetches Google Public Keys (JWKS).
    - Verifies the `FirebaseIdToken` signature and claims.
    - Maps the `sub` (Firebase UID) to a local `user_id`.
    - Issues `LocalAccessToken` and `LocalRefreshToken`.
4.  **Response**: `{ "access_token": "...", "refresh_token": "..." }` (or Set-Cookie for refresh).

### B. Native Login Flow (Username/Password)
1.  **Request**: `POST /api/auth/login/native { "username": "...", "password": "..." }`
2.  **Backend**:
    - Retrieves hashed password (Argon2id) for the username.
    - Verifies credentials.
    - Issues `LocalAccessToken` and `LocalRefreshToken`.
3.  **Response**: `{ "access_token": "...", "refresh_token": "..." }`

### C. Service Account Login Flow
Service accounts (Agents/CLIs) do not use interactive login. They use a **Service Key**.

1.  **Setup**: Admin creates a Service Account in the DB, generating a `ServiceKey` (e.g., `md-bug-sa_xxxxxxx`).
2.  **Request**: `POST /api/auth/login/service { "key": "..." }`
3.  **Backend**:
    - Hashes the provided key and compares it with the stored hash (like a password).
    - Issues a `LocalAccessToken`. Note: Service accounts may or may not use refresh tokens depending on if they are long-lived or session-based.
4.  **Response**: `{ "access_token": "..." }`

### D. Token Refresh Flow (Daily Login)
1.  **Request**: `POST /api/auth/refresh { "refresh_token": "..." }`
2.  **Backend**:
    - Validates token existence and expiry in the database.
    - Performs **Refresh Token Rotation** (invalidates old, issues new).
3.  **Response**: `{ "access_token": "...", "refresh_token": "..." }`

---

## 3. Service Account Security

### Key Properties
- **Non-Interactive**: No MFA or passwords.
- **Scoping**: Service accounts should typically be restricted to specific components or read-only access.
- **Revocation**: The `ServiceKey` should be easily rotatable without affecting the actual user accounts.

### Storage
Store service keys using the same logic as passwords (**Argon2id**). When an agent sends the key, hash it and compare. Never store the raw key.

---

## 4. Required HTTP API Summary

| Endpoint | Method | Input | Output | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/login/firebase` | POST | `{ token }` | Local JWT Pair | Exchange Firebase token for local session. |
| `/api/auth/login/native` | POST | `{ user, pass }` | Local JWT Pair | standard login for local users. |
| `/api/auth/login/service` | POST | `{ key }` | Local JWT | Authentication for automated agents. |
| `/api/auth/refresh` | POST | `{ refresh_token }` | Local JWT Pair | Use long-lived token to get new access token. |
| `/api/auth/logout` | POST | N/A | Success | Invalidate the refresh token in the DB. |

---

## 5. Security Mandates in Rust

1.  **Token Signing**: Use `Ed25519` for signing local JWTs. It's faster and more secure than RSA for this use case.
2.  **Database Storage**:
    - `refresh_tokens` table: `token_hash`, `user_id`, `expires_at`, `created_at`.
    - `service_accounts` table: `name`, `key_hash`, `permissions`.
3.  **Middleware Extraction**: 
    - Every API call (except `/api/auth/*`) requires the `Authorization: Bearer <LocalAccessToken>` header.
    - Use an Axum `Extractor` to validate the local JWT and provide a `RequestUser` struct to the handler.

```rust
pub struct RequestUser {
    pub id: u64,
    pub is_service_account: bool,
}
```

---

## 6. Refined Implementation Checklist
- [ ] Implement `LocalJwtProvider` (Ed25519 signing/verification).
- [ ] Implement `Argon2` password/key hasher.
- [ ] Add `RefreshToken` and `ServiceAccount` models to the DB layer.
- [ ] Implement the 4 login/refresh endpoints listed above.
- [ ] Update `AppState` to hold the JWT secret/keys.
