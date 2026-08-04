# CLAUDE.md — frontend

React 19 + MUI 9 + TypeScript, bundled with esbuild. See `../CLAUDE.md` for repo-wide
context and [../API.md](../API.md) for the API this client talks to.

## Package management

Use **pnpm** to install/add/remove packages. `npm run <script>` is fine for running
scripts.

Within MonoParra, `"standard-ts-lib": "file:../../standard-ts-lib"` resolves through the
`tools/standard-ts-lib` symlink to `common/standard-ts-lib` — mirroring the tracked
symlinks in `obsidian/`. If `pnpm install` fails with `ENOENT … tools/standard-ts-lib`,
that symlink is missing, not the dependency.

`pnpm-workspace.yaml` here exists solely to allow esbuild's postinstall
(`allowBuilds: {esbuild: true}`); without it pnpm skips the build script.

## Scripts

All are one esbuild invocation over `src/index.tsx` → `public/bundle.js` (+ `bundle.css`),
differing only in flags:

| Script | `USE_FAKE_API` | `DEBUG_MODE` | Notes |
|---|---|---|---|
| `build` | false | false | minified; the release build |
| `build-dev` | false | true | unminified |
| `watch-dev` | false | true | `--watch`; used by root `npm start` |
| `fakeapi-build` | **true** | true | minified, no backend needed |

`USE_FAKE_API` selects `src/api/fake_api.ts` over `src/api/backend_api.ts` at bundle
time — use `fakeapi-build` to work on UI without running Rust.

`public/bundle.js` is gitignored; `public/index.html`, `favicon.svg`, `icons.svg` are checked in.

## Auth

- **`api/auth_api.ts`** — `/api/auth/*` client (login, refresh, change password, logout,
  user creation, personal access tokens), plus the module-level active session.
  Deliberately separate from `BackendApi`: these are the only calls that must work
  *without* a token.
- **`api/backend_api.ts`** — every method funnels through one private `request` helper
  that attaches `Authorization: Bearer` and, on a 401, refreshes once and retries. **No
  API method takes a username** any more; identity rides in the token.
- **`LoginView`** takes a username *and password*. **`ChangePasswordView`** handles the
  forced rotation the backend imposes on machine-generated and admin-set passwords —
  while that flag is set the server 403s everything else, so `App` renders it instead of
  the app and gives it no escape hatch.
- Concurrent 401s share a single in-flight refresh (`refreshActiveSession`). Without
  that, parallel requests would each redeem the refresh token, and since the server
  rotates on use all but the first would fail and log the user out.
- After a password change every token for the account is revoked server-side, so the UI
  drops its session and returns to sign-in. That is correct, not a bug.

## Serve it from the backend, not standalone

The API base URL comes from `window.location.origin` (`defaultBaseUrl` in `api/api.ts`),
so the app works on whatever port the backend listens on. It was previously hardcoded to
`http://localhost:9000`, which silently broke any other port — including the e2e run.

The backend still installs **no CORS layer**, so the page and the API must share an
origin. `npm run serve` puts the bundle on a different port and every call fails as a
CORS/network error with status 0, which looks nothing like a real API failure.

## Component tests

`npm test` runs jsdom render tests (jest + React Testing Library), one suite per view:
`App`, `Layout`, `HomeView`, `BugView`, `CreateIssueView`, `CreateComponentView`,
`ComponentEditorView`, `LoginView`, `ChangePasswordView`. No backend required.

For the full browser flow against a real backend, see `../e2e/CLAUDE.md`.

- **`src/test/harness.tsx`** — `renderWithProviders` / `renderWithProvidersAsync` (router
  + MUI theme), `useStubApi(overrides)` to install an in-memory API via the `inject_api`
  seam, and shared fixtures (`testBug`, `testComponents`, …).
- **`src/test/setup.ts`** — polyfills jsdom is missing (`TextEncoder`, `structuredClone`
  via V8 serialization so BigInt survives, `matchMedia`, IndexedDB, `Temporal`) and
  **turns any `console.error`/`console.warn` into a test failure**.

That last point is the reason these tests are worth running. React reports unknown DOM
props through `console.error`, and MUI reports things like out-of-range `Select` values
through `console.warn` — neither fails a normal render assertion, and esbuild never sees
them. Escalating them is what catches MUI-9 migration regressions.

Consequences to know:

- Use **`renderWithProvidersAsync`** for any view whose `useEffect` awaits the API.
  A plain `render` lets the resulting `setState` land outside `act()`, which React warns
  about — and the setup file turns that warning into a failure.
- If a test fails with "Unexpected console.error", read the message before touching the
  test. It is usually a real defect in the component.

Fixtures must match the real types: `GroupPermissions.view_level` is a **number**, not a
string, and `BugMetadata` has `type` — there is no `bug_type` (that lives on
`ComponentMetadata`).

## Type checking is NOT part of the build

esbuild strips types without checking them. `npm run build` passing means nothing about
type correctness. Run:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

There is a **backlog of pre-existing errors** (unused imports, a few real ones). Diff
against a baseline instead of expecting a clean run:

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | sort > /tmp/after.txt
git stash push -- src && npx tsc --noEmit -p tsconfig.app.json 2>&1 | sort > /tmp/before.txt; git stash pop
comm -13 /tmp/before.txt /tmp/after.txt   # errors you introduced
```

## MUI 9 — legacy prop names are removed, not deprecated

MUI 9 deleted the old `*Props` escape hatches in favor of `slots`/`slotProps`. Because
they're no longer recognized, they fall through to the DOM and React logs
*"React does not recognize the `X` prop on a DOM element"* at runtime; `tsc` catches them
but the esbuild build does not. Migrations already applied here:

| Removed | Replacement |
|---|---|
| `<Menu PaperProps={{…}}>` | `slotProps={{paper: {…}}}` |
| `<ListItemText primaryTypographyProps={{…}}>` | `slotProps={{primary: {…}}}` |
| `<CardHeader titleTypographyProps={{…}}>` | `slotProps={{title: {…}}}` |
| `<TextField InputProps={{…}}>` | `slotProps={{input: {…}}}` |
| `<Grid item xs={6}>` | `<Grid size={6}>` |

Two traps:

- `slotProps.primary` is typed as `TypographyProps`, which does **not** accept bare
  system props. `{fontSize: '0.9rem'}` is a type error — use `{sx: {fontSize: '0.9rem'}}`.
- `inputProps` (lowercase, on `InputBase`) still exists and is *not* the same as the
  removed `InputProps`. Don't "fix" it.

Grid v2 has no `item`/`xs`/`md` props at all; a bare `item` reaches the DOM and triggers
*"Received `true` for a non-boolean attribute"*.

## Structure

```text
src/
├── index.tsx, main.tsx     # entry
├── App.tsx                 # routing + auth gate (login / forced change / app)
├── Layout.tsx              # app bar, drawer, create menu
├── HomeView, BugView, CreateIssueView,
│   CreateComponentView, ComponentEditorView, LoginView, ChangePasswordView
├── api/
│   ├── api.ts              # get_api() facade, shared types, defaultBaseUrl
│   ├── auth_api.ts         # /api/auth/* client + active session
│   ├── backend_api.ts      # real client (bearer token + refresh-on-401)
│   ├── fake_api.ts         # in-memory stand-in
│   └── storage.ts          # IndexedDB (md-bug-db/settings): username + session
└── theme.ts, *.css
```

## Error handling

Use `standard-ts-lib`: fallible calls return `Result<T, StatusError>`, absent values use
`Optional<T>`, external promises go through `WrapPromise`, throwing calls through
`WrapToResult`. No `try/catch`, no raw `null` checks. Deep-import:
`import {Ok, type Result} from 'standard-ts-lib/src/result'`.

## Domain notes

- **Login is real.** Username + password against `/api/auth/login`; the session lives in
  IndexedDB under the `session` key. A **401** means the token is missing or expired; a
  **403** means an ACL rejected you or a forced password change is pending — never a bad
  password, which surfaces as 401 from the login call itself.
- **`u64` arrives as `"123n"`** — always go through `bigIntReviver`/`bigIntReplacer`.
- **Sanitize all rendered Markdown with `dompurify`** before `marked` output reaches the
  DOM. Non-negotiable.
- **Root components cannot be created from the UI** — the backend 403s `parent_id: 0` by
  design, so `CreateComponentView` disables that option.
