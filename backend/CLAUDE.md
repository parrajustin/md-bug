# CLAUDE.md — backend

Rust + Axum backend for `md-bug`. See `../CLAUDE.md` for repo-wide context and
`GEMINI.md` in this directory for the full architecture/permission write-up — this file
is the operational quick reference.

## Binaries

Two, both from this crate:

- **`md-bug-backend`** (`src/main.rs`) — the HTTP server.
- **`md-bug-cli`** (`src/cli.rs`) — a CLI that hits the same API, either against a data
  directory (`--root`) or a live server (`--remote host:port`). Exactly one API
  subcommand and exactly one source are required (enforced by clap `ArgGroup`).

  Identity: `--remote` requires `--token` (or `MD_BUG_TOKEN`) and sends it as a bearer
  header. `--root` takes `--user` (default `admin`) and constructs the identity directly
  via `RequestUser::local`, skipping token checks — not an escalation, since local mode
  already implies filesystem access to the very files the ACLs protect. Note the `"u"`
  key inside the legacy JSON payload blobs is now **ignored**; serde discards it.

## Running the server

```bash
cargo run --bin md-bug-backend -- -r ./bug-data -p 9000
```

| Flag | Env | Default | Meaning |
|---|---|---|---|
| `-r, --root` | `BUG_ROOT` | *(required)* | Data directory; created if absent |
| `-p, --port` | `BUG_PORT` | `8080` | Listens on `0.0.0.0:<port>` |
| `-f, --frontend-dir` | `FRONTEND_DIR` | `../frontend/public` | Static files, SPA-fallback to `index.html` |
| `--fake_data` | `GENERATE_FAKE_DATA` | `false` | Seed sample data at startup |
| `--CreateRootComponent <name>` | `CREATE_ROOT_COMPONENT` | — | Bootstrap a root component, then **exit** |
| `--AdminUserId <user>` | `ADMIN_USER_ID` | — | Required with the above |
| `--AdminUsername <user>` | `ADMIN_USERNAME` | `admin` | Bootstrap administrator, created on first run |
| `--CreateUser <name>` | `CREATE_USER` | — | Create a user (prompts for password), then **exit** |
| `--CreateAdmin` | — | `false` | Make `--CreateUser`'s account an admin |

On startup the server ensures `<root>/default/` exists — but it **never writes
`component_metadata` there**, so `default/` stays invisible to `ComponentIdCache`
(which only registers directories containing that file). An empty data dir therefore
has *zero* usable components until you run `--CreateRootComponent`.

## Routes

All registered in `src/main.rs`; handlers in `src/api.rs`. Everything else falls through
to the static file service.

```text
POST /api/auth/login                        POST /api/auth/refresh
POST /api/auth/change_password              POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/users                        GET  /api/auth/users          (admin only)
POST /api/auth/tokens                       GET  /api/auth/tokens
DELETE /api/auth/tokens/:id

GET  /api/bug_list                          POST /api/create_bug
GET  /api/bug/:id                           GET  /api/bug/:id/state
POST /api/bug/:id/comment                   POST /api/bug/:id/update_metadata
GET  /api/component_list                    POST /api/create_component
GET  /api/component/:id/get_metadata        POST /api/component/:id/update_metadata
POST /api/component/:id/add_template        POST /api/component/:id/modify_template
POST /api/component/:id/delete_template
```

Note the method matters: `create_component` is `post` only, so a GET yields **405**, not 403.

## Authentication

Every route except `/api/auth/*` requires `Authorization: Bearer <token>`. Identity is
**never** taken from the request body or query string — the old spoofable `u` field is
gone from all 13 handlers.

Enforcement is by extractor, not middleware: handlers take a `RequestUser` parameter
(`api.rs`), whose `FromRequestParts` impl validates the token. A handler that needs
identity cannot compile without it, and cannot run unauthenticated.

**Tokens are opaque, not JWTs** — `auth.md` specifies Ed25519 JWTs and is *not* what was
built. For a single-process file-backed server, stateless verification buys nothing while
revocation would need a denylist anyway. Format: `mdb_<kind>_<id>.<secret>`, 32 CSPRNG
bytes, only `SHA-256(secret)` persisted. The id makes lookup O(1).

SHA-256 is correct *here* and would be wrong for a password: the secret has 256 bits of
entropy, so a slow hash buys nothing, and verification runs on every request. Argon2 stays
on passwords. The pre-existing `verify_service_key`-style helpers ran Argon2 against every
stored row — O(n) per auth — which is why the token path does not use that pattern.

Three kinds:

| Kind | Prefix | TTL | Purpose |
|---|---|---|---|
| Access | `mdb_at_` | 12h | Normal session |
| Refresh | `mdb_rt_` | 30d | Rotated on use — single-use, consumed on redemption |
| Personal | `mdb_pat_` | none | Long-lived, acts as its owner; for agents and CI |

A personal token **cannot mint further tokens** (else a leaked one renews itself forever),
and `logout` deliberately leaves them alive — they represent automation, not the session.

### Bootstrap and accounts

First startup with no accounts creates an admin (`--AdminUsername`/`ADMIN_USERNAME`,
default `admin`), prints a random password **once**, and flags it `must_change_password`.
While that flag is set, `RequestUser` returns 403 for everything — so the only possible
action is `POST /api/auth/change_password`, which authenticates by *current password*
rather than a bearer token precisely so the flag is escapable. Changing a password revokes
all of that user's tokens.

Accounts are admin-created only (`POST /api/auth/users`, or `--CreateUser` which prompts
on stdin so the password never reaches shell history). There is no self-signup. The
username `PUBLIC` is rejected — it is the wildcard member in every ACL, so a real account
by that name would inherit every grant in the system.

### Authorization

Authentication answers *who*; the per-component ACLs still answer *what*. A valid token
gets you a 401→200; it does not get you past `has_permission`. Permissions come from
`component_metadata` files, resolved by
`resolve_component_metadata` walking root→target and merging (child wins). The
`Permission` enum: `ComponentAdmin`, `CreateIssues`, `AdminIssues`, `EditIssues`,
`CommentOnIssues`, `ViewIssues`. Members are listed per group; the literal `PUBLIC`
matches every user.

Access is strictly tiered: **Full > Comment > View**, each implying the ones below.
`ComponentAdmin` governs the component itself (metadata, templates, sub-components) and
grants **no** rights over bugs inside it — that's `AdminIssues`/`EditIssues`, which do
confer Full access to bugs in the subtree.

### The two 403s in `create_component`

1. `parent_id == 0` → unconditional 403. Root creation via the API is a **hard mandate**;
   do not add bootstrap logic to circumvent it, no matter how convenient. Root components
   are created on disk only (`--CreateRootComponent`, see above).
2. Caller lacks `ComponentAdmin` on the resolved parent metadata.

Both are covered by `src/api/api_test.rs`.

## Persistence

- **Components are directories.** Hierarchy is the filesystem tree.
- **Metadata is rkyv**, not JSON — zero-copy, binary, not human-editable.
- **Bug bodies/comments are Markdown.** The description lives in `BugMetadata`, *not* as
  comment #0. Comments are separate sequential files (`comment_0000001`).
- **Numeric folder names are reserved for bug IDs**; components may never be purely numeric.
- **`BugIdCache`** (`src/bug_id_cache.rs`) maps bug ID → component path and tracks next
  IDs, avoiding full-disk scans. **`ComponentIdCache`** (`src/component_id_cache.rs`)
  does the same for components, populated only from dirs containing `component_metadata`.
- Component names are sanitized to lowercase alphanumeric + underscores; on-disk
  collisions get a numeric suffix even when display names differ.

## Wire format gotcha

Rust `u64` serializes to JSON as a **string with an `n` suffix** (`"123n"`) so the
frontend can revive it as a JS `BigInt`. Any new `u64` field inherits this; hand-written
JSON in tests must match.

`state_id` exists on every bug and component and **must be incremented on every
modification** — the frontend uses it for cache invalidation and optimistic concurrency.

## Rules

- **`.unwrap()` is banned.** Use `?`, `match`, `if let`, `unwrap_or_else`. Use
  `.expect("reason")` only when failure is truly impossible, and say why.
- Handlers return `Result<impl IntoResponse, StatusCode>`.
- Tests go in **separate files** (`api_test.rs`, `bug_id_cache_test.rs`, …), pulled in
  with `#[cfg(test)] mod <name>;` — never inline in the implementation file.
- When adding a metadata field, remember the `match` arm in `change_metadata`, or the
  frontend silently cannot update it.

## Verification

`cargo test` here is mandatory for every backend change. Follow with
`cd ../integration_tests && npm test`, which spawns a real server process.
