# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in the `md-bug` repository.

`md-bug` is a Markdown-first bug/task tracker: a Rust (Axum) backend that persists
everything to a directory tree on disk, and a React + TypeScript frontend. It is
designed to be driven by agents as well as humans.

See also:

- **[API.md](API.md)** — the HTTP API in full: how to authenticate, every endpoint, what
  comes back, and the traps (`u64` arrives as `"7n"` strings, `401` vs `403`, API tokens
  vs bot accounts). Read this before writing any client, script or agent against the API.
- `GEMINI.md` (product concepts and mandates) and `memories.md` (accumulated tribal
  knowledge) — the source of truth for domain rules, and still current.

This file covers how to *build, run, and not break* things.

## Repository layout

This repo is a git submodule of **MonoParra**, checked out at `tools/md-bug`.

```text
md-bug/
├── backend/            # Rust (Axum). Two binaries: md-bug-backend, md-bug-cli
├── frontend/           # React 19 + MUI 9, bundled with esbuild
├── integration_tests/  # Jest; spawns the real backend binary
├── e2e/                # Chrome + golden screenshots (see e2e/CLAUDE.md)
├── API.md              # The HTTP API: auth, endpoints, response shapes
├── skills/
├── Dockerfile, Dockerfile.root
├── release.sh          # builds + pushes xerofuzzion/md-bug (see Releasing)
└── package.json        # root: only `npm start` (concurrently runs both halves)
```

There is no workspace/monorepo tooling here — `backend/`, `frontend/`, and
`integration_tests/` each have their own dependencies. Run commands from inside the
relevant directory.

## Running the app

From the repo root, `npm run start` runs both halves via `concurrently`:

- backend: `cd backend && cargo run --bin md-bug-backend -- -r ./bug-data -p 9000`
  (restarted by nodemon on `backend/src/**/*.rs` changes)
- frontend: `cd frontend && npm run watch-dev` (esbuild `--watch` into `frontend/public/`)

The backend serves `frontend/public/` as static files and falls back to `index.html`,
so **open `http://localhost:9000`** — the frontend is same-origin with the API. The API
base URL is derived from `window.location.origin` (`defaultBaseUrl` in
`frontend/src/api/api.ts`), so any port works as long as the page and the API share an
origin. There is still **no `CorsLayer` installed**, so serving `frontend/public/`
separately (e.g. `npm run serve`) breaks every call with a CORS error, not a useful
status code.

### First start is self-setting-up

On first start the server creates a top-level component called **DEFAULT** (folder
`default/`, `parent_id` 0), owned by the bootstrap admin. A fresh install is therefore
immediately usable — you can file a bug and nest components without any manual step.

It is written only when `default/component_metadata` is missing, so restarts never
duplicate or renumber it. That also self-heals older installs, which created an empty
`default/` directory and never gave it metadata, leaving it invisible to
`ComponentIdCache`.

Additional roots: an **administrator** can create one from the UI — *Create Component* →
*Create as a root component* — which posts to the admin-only `/api/create_root_component`.
Non-admins do not see the toggle. `create_component` still returns 403 for
`parent_id == 0`. To create one out-of-band:

```bash
cd backend
cargo run --bin md-bug-backend -- -r ./bug-data \
  --CreateRootComponent "<display name>" --AdminUserId "<username>"
```

This writes `bug-data/<sanitized_name>/component_metadata` and exits without serving.
`<username>` is an ACL entry, matched as a literal string — it must equal the username of
an actual account, or nobody will hold `ComponentAdmin` on that root.

Alternatively `--fake_data` (or `GENERATE_FAKE_DATA=1`) seeds sample components.

## Authentication

Every route except `/api/auth/*` requires `Authorization: Bearer <token>`. Opaque
database-backed tokens, not the JWTs described in `backend/auth.md` — see
`backend/CLAUDE.md` for the design and `frontend/CLAUDE.md` for the client.

First run generates an admin password, prints it **once**, and forces a rotation before
the account can do anything. Accounts are admin-created; there is no self-signup.

Personal access tokens are **bot identities** with generated names
(`admin--long_cat_fat`), addable to ACLs like a user, capped at their creator's
permissions, and excluded from `PUBLIC` — see `backend/CLAUDE.md`. Manage them from the
account page (avatar → Account).

Note the distinction when debugging: **401** means the token is missing, expired or
invalid; **403** means either a per-component ACL rejected you, a forced password change
is pending, or you hit the hardcoded root-creation ban. Authentication and authorization
are separate layers — a valid token still has to pass `has_permission`.

## Backend CLI

`backend/src/cli.rs` builds a second binary, `md-bug-cli`, that exercises the API either
against a local data dir (`--root`) or a running server (`--remote host:port`). Useful
for reproducing API behavior without the browser.

## Releasing

`./release.sh` builds the server image and pushes it to Docker Hub as
`xerofuzzion/md-bug:v<N>-<arch>` plus `latest-<arch>`, where `<N>` comes from
`version.json` and is bumped only after every push succeeds. amd64 is always built;
**arm64 only with `--arm64`**, because the Rust backend then compiles under QEMU
emulation and takes many minutes. Requires `docker login` and `jq`.

The build context is this directory, but the frontend needs `standard-ts-lib`, which
lives outside it — and in MonoParra `tools/standard-ts-lib` is a symlink into `common/`,
which BuildKit refuses to follow. So `Dockerfile` takes it as a **named build context**
(`COPY --from=standard_ts_lib`) and `release.sh` passes
`--build-context standard_ts_lib=../standard-ts-lib`. A bare `docker build .` fails
without that flag. `Dockerfile.root` is not published and still expects the *parent*
directory as its context (`docker build -f md-bug/Dockerfile.root ..`).

## Verification

Both are mandates, not suggestions:

- `cd backend && cargo test` — 47 unit tests covering ID caches, permissions, API
  handlers, token issue/verify/revoke, and the account store.
  They live on the **lib** target; the three bin targets have none, so a truncated view
  of the output can look like nothing ran. `cargo test --lib` shows them directly.
- `cd integration_tests && npm test` — spawns the real binary and drives the full stack.
- `cd frontend && npm test` — jsdom render tests, one suite per view. See
  `frontend/CLAUDE.md`; they fail on any React/MUI console warning, which is how MUI
  migration regressions get caught.
- `cd frontend && npm run build` must pass for any frontend change.
- `cd e2e && npm test` — real Chrome against a real backend, comparing golden
  screenshots of the whole login → forced-password-change → signed-in flow. Build the
  frontend first; see `e2e/CLAUDE.md`.

Note `npm run build` uses **esbuild, which does not type-check**. Run
`npm run type-check` (`tsc --noEmit -p tsconfig.app.json`) separately — the frontend
currently has a backlog of pre-existing type errors (unused imports and similar), so
compare against a baseline rather than expecting zero output.

## Language rules

- **Rust:** `.unwrap()` is banned. Use `?`, `match`, `if let`, or `unwrap_or_else`. If a
  failure is genuinely impossible, `.expect("why it is safe")`. Tests live in separate
  files (`api_test.rs`) included via `#[cfg(test)] mod ...;`.
- **TypeScript:** use `standard-ts-lib` (`Result`, `Optional`, `StatusError`,
  `WrapPromise`, `WrapToResult`) rather than raw `null` checks, thrown errors, or
  `try/catch`. Import with absolute specifiers: `import {Ok} from 'standard-ts-lib/src/result'`.
  Within MonoParra this resolves through the `tools/standard-ts-lib` symlink to
  `common/standard-ts-lib`.

## Conventions worth knowing before editing

- **`u64` crosses the wire as `"123n"` strings.** The frontend converts with
  `bigIntReviver` / `bigIntReplacer` to JS `BigInt`. Don't hand-roll JSON for these.
- **`state_id` must increment on every write** — it drives frontend cache invalidation.
- **Numeric directory names are reserved for bug IDs**; components can never have a
  purely numeric name.
- **Components are directories**; permissions live in `component_metadata` (rkyv-encoded)
  and are resolved by merging root→target, child overriding parent.
- **`PUBLIC`** in any member/access list grants that permission to everyone.

## Memories

When you learn something non-obvious about this project, add it to `memories.md`.
