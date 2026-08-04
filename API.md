# md-bug HTTP API

Everything the UI does goes through this API, so anything the UI can do, a script can do.
It is designed to be driven by agents as much as by people.

- **Base URL** — the server's own origin. It serves the built frontend itself, so in a
  browser the API is same-origin. There is **no CORS layer**, so a client served from a
  different origin fails with a network error rather than a useful status.
- **Content type** — `application/json` for every request with a body.
- **Auth** — `Authorization: Bearer <token>` on every route except the three noted below.

---

## 1. Authentication

### Getting a token

Everything starts with a password login. There is no self-signup; accounts are created by
an administrator (§4).

```bash
curl -sX POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}'
```

```json
{
  "access_token": "mdb_at_12.4f...",
  "refresh_token": "mdb_rt_13.9a...",
  "username": "admin",
  "is_admin": true,
  "must_change_password": false,
  "expires_in": 43200
}
```

Then send it on every call:

```bash
curl -s "$BASE/api/component_list" -H "Authorization: Bearer $ACCESS_TOKEN"
```

**A bad username and a bad password both return `401`**, deliberately — the endpoint
cannot be used to discover which accounts exist. A **disabled** account returns `401` too,
for the same reason.

### The four kinds of token

Tokens look like `mdb_<kind>_<id>.<secret>`. The kind is visible in the prefix.

| Kind | Prefix | Lifetime | What it is |
|---|---|---|---|
| Access | `mdb_at_` | 12 h | A session. What login returns. |
| Refresh | `mdb_rt_` | 30 d | Exchanged for a new pair; single-use. |
| API | `mdb_api_` | none | **Your own** credential for scripting. Acts as you. |
| Bot | `mdb_bot_` | none | A **separate account** with its own ACL identity. |

**API and bot tokens are not the same thing, and the difference matters:**

- An **API token** *is you*. It carries your permissions, needs no grants of its own, and
  can reach anything you can reach. Use it for your own automation.
- A **bot token** is a *different principal*. It has its own name (e.g.
  `admin--long_cat_fat`) that you add to component groups and bug access lists exactly
  like a username. It is capped at whatever its creator can do, and it does **not**
  inherit `PUBLIC` access — it sees nothing until it is explicitly granted something. Use
  it when automation should have narrower access than you.

Neither an API nor a bot token can create further tokens (`403`), so a leaked credential
cannot renew itself after the original is revoked.

### Refreshing

Access tokens expire after 12 hours. Trade the refresh token for a new pair:

```bash
curl -sX POST "$BASE/api/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"mdb_rt_13.9a..."}'
```

The response is the same shape as login. **Refresh tokens rotate**: the one you present is
consumed, and the response carries a new one. A stolen refresh token is therefore usable
at most once, and only until the legitimate client next refreshes.

Concurrent refreshes are a footgun — two requests redeeming the same token means one of
them fails. Serialise them.

### Forced password rotation

An account whose password was chosen by someone else — the bootstrapped admin, or anyone
an admin creates — is flagged `must_change_password`. While that flag is set, **every
endpoint except the auth ones returns `403`**.

Login still succeeds and reports the flag; the only useful next call is:

```bash
curl -sX POST "$BASE/api/auth/change_password" \
  -H 'Content-Type: application/json' \
  -d '{"username":"newbie","current_password":"<generated>","new_password":"..."}'
```

Note this endpoint authenticates with the **current password, not a bearer token** —
precisely so an account under forced rotation can use it. If it needed a token, the flag
would be inescapable.

Changing a password **revokes every token for that account**. Whatever session you were
holding is dead; log in again.

### The three public routes

`POST /api/auth/login`, `POST /api/auth/refresh` and `POST /api/auth/change_password` work
without a token, because otherwise nobody could ever obtain one. **Every other route
returns `401` without a valid token** — this is asserted by a test that reads the route
list out of the source, so a route added later cannot quietly skip it.

---

## 2. What to expect back

### Status codes

| Code | Meaning here |
|---|---|
| `200` | Success, with a JSON body. |
| `201` | Created. Some return the new id, some return no body — noted per endpoint. |
| `204` | Success, no body. |
| `400` | Malformed or rejected input (bad password length, unusable name). |
| `401` | Missing, expired, malformed or revoked token; or bad credentials. |
| `403` | Authenticated but not allowed: an ACL said no, a forced password change is pending, you are not an admin, or you tried to create a root through `create_component`. |
| `404` | No such bug, component, or token. |
| `405` | Wrong method — check the verb before assuming an auth problem. |
| `409` | Conflict: username or component name already taken. |
| `422` | The JSON did not match the expected shape. |

**`401` vs `403` is worth internalising.** `401` means *we do not know who you are*.
`403` means *we know, and the answer is still no*. If a script suddenly starts getting
`403` on everything, look for a pending password change before suspecting permissions.

### `u64` values are strings with an `n` suffix

Rust `u64` does not survive JavaScript's `Number`, so these fields cross the wire as
strings ending in `n`:

```json
{ "state_id": "7n", "created_at": "1718016000000000000n" }
```

The affected fields are **`state_id`**, **`created_at`**, **`last_updated_at`** and
**`epoch_nanoseconds`**. Strip the trailing `n` and parse as a big integer. The frontend
does this with `bigIntReviver` / `bigIntReplacer`; a non-JS client should do the
equivalent. Timestamps are **epoch nanoseconds**, not seconds or milliseconds.

### `state_id`

Every bug and component carries a `state_id` that increments on each write. Use it for
cheap change detection: `GET /api/bug/:id/state` returns just that number, so a poller can
skip a full fetch when nothing has changed.

A no-op write does **not** bump it — starring something you already starred leaves it
alone, so it will not trigger a pointless refetch.

---

## 3. Identity is never in the payload

There is no `u` or `username` parameter anywhere. The caller is whoever the bearer token
says they are. Earlier versions took a username in the body, which anyone could set to
anyone else's.

The same applies inside requests: `POST /api/bug/:id/comment` takes only `content`, and
the comment is attributed to the token holder. There is no `author` field to set.

---

## 4. Accounts

### `POST /api/auth/users` — create a user *(admin only)*

```json
{ "username": "alice", "is_admin": false }
```

→ **`201`**

```json
{ "username": "alice", "uid": 4, "password": "hK3f..." }
```

**The password is generated and returned exactly once.** It is stored only as an Argon2
hash and cannot be read back — if it is lost, the account needs a new one. Hand it to the
person; they are forced to replace it on first login.

Usernames may not contain `:` or `--` (reserved for bot identities), and `PUBLIC` is
rejected outright since it is the wildcard member in every ACL. `409` if taken.

### `GET /api/auth/users` — list accounts *(admin only)*

Array of `{username, uid, is_admin, must_change_password, disabled}`. Never includes
hashes.

### `POST /api/auth/users/:username/disabled` — enable/disable *(admin only)*

```json
{ "disabled": true }
```

→ **`204`**

Disabling blocks login **and revokes the account's existing tokens immediately**, rather
than letting live sessions run until they expire. `400` if you target yourself — that
would leave nobody able to undo it.

### `GET /api/auth/me`

```json
{
  "username": "admin--long_cat_fat",
  "owner_username": "admin",
  "uid": 1,
  "is_admin": false,
  "via_long_lived_token": true,
  "is_bot": true
}
```

`username` is the identity used for permission checks; for a bot that differs from
`owner_username`. Note `is_admin` is **always false for a bot**, whatever its owner is —
admin rights create accounts and mint tokens, which a leaked bot key must not do.

### `POST /api/auth/logout`

→ **`204`**. Revokes your access and refresh tokens. **API and bot tokens survive** —
they represent automation, not the session you are ending.

---

## 5. Tokens

| Endpoint | Method | Result |
|---|---|---|
| `/api/auth/tokens` | POST | `201` `{id, label, token}` — an API token |
| `/api/auth/tokens` | GET | Your API tokens, without secrets |
| `/api/auth/tokens/:id` | DELETE | `204`, `404` if not yours |
| `/api/auth/bots` | POST | `201` `{id, identity, token}` — a bot account |
| `/api/auth/bots` | GET | Your bots |
| `/api/auth/bots/:id` | DELETE | `204`, `404` if not yours |

Both creates take **no body content** — names are generated, because a human-chosen label
is the thing most likely to collide with, or be mistaken for, a real account. The
plaintext token appears only in the create response.

To give a bot access to something, add its `identity` to a component group's `members` or
to a bug's `full_access` / `comment_access` / `view_access` list, exactly as you would a
username.

### Admin token management

| Endpoint | Method | Result |
|---|---|---|
| `/api/auth/admin/tokens` | GET | Every token in the system *(admin only)* |
| `/api/auth/admin/tokens/:id` | DELETE | Revoke anyone's token *(admin only)* |

Entries carry `{id, username, kind, label, identity, created_at, expires_at}` where `kind`
is `"Access"`, `"Refresh"`, `"Api"` or `"Bot"`. `Access` rows are live logins, so this
doubles as "who is signed in". Unlike the per-user endpoints, this revoke does **not**
check ownership — cutting off someone else's compromised session is the point.

---

## 6. Components

Components are a hierarchy, stored as directories. Permissions live on them and are
inherited downwards.

| Endpoint | Method | Notes |
|---|---|---|
| `/api/component_list` | GET | Components you can view |
| `/api/create_component` | POST | `201`, **no body** |
| `/api/create_root_component` | POST | `201` + new id *(admin only)* |
| `/api/component/:id/get_metadata` | GET | Full resolved metadata |
| `/api/component/:id/update_metadata` | POST | `{metadata: {...}}` |
| `/api/component/:id/add_template` | POST | `{template: {...}}` |
| `/api/component/:id/modify_template` | POST | `{old_name, template}` |
| `/api/component/:id/delete_template` | POST | `{name}` |

`GET /api/component_list` returns `{id, name, description, folders, parent_id, creator}`.
`creator` is who made it — the precise signal for "components I own", since admin rights
inherit down the tree and `PUBLIC` matches everyone.

### Creating components

```json
{ "name": "Frontend", "description": "UI code", "parent_id": 2 }
```

**`create_component` rejects `parent_id: 0` with `403`, always, even for admins.** Root
components come only from `POST /api/create_root_component` (admin only) or the
`--CreateRootComponent` CLI flag. Keeping them apart means the ordinary path has no
privileged branch to get wrong.

Names are sanitised to lowercase alphanumerics and underscores; a collision on disk gets a
numeric suffix. A name with no alphanumeric characters at all is `400` — `"!!!"` would
otherwise become `"___"`.

On first start the server creates a top-level component named **DEFAULT**, so a fresh
install has somewhere to file bugs without any setup.

### Permissions

`ComponentAdmin`, `CreateIssues`, `AdminIssues`, `EditIssues`, `CommentOnIssues`,
`ViewIssues`, granted through named groups whose `members` are usernames or bot
identities. The literal `PUBLIC` matches every **person** — but never a bot.

Access is tiered: **Full > Comment > View**, each implying those below.
`ComponentAdmin` governs the component itself (metadata, templates, sub-components) and
grants **no** rights over the bugs inside it; that is `AdminIssues` / `EditIssues`.

---

## 7. Bugs

| Endpoint | Method | Notes |
|---|---|---|
| `/api/bug_list` | GET | `?q=<search>`; bugs you can view |
| `/api/create_bug` | POST | `200` + new id |
| `/api/bug/:id` | GET | Full bug: metadata + comments |
| `/api/bug/:id/state` | GET | `{state_id}` only — cheap polling |
| `/api/bug/:id/comment` | POST | `{content}` → `{comment_id, state_id}` |
| `/api/bug/:id/update_metadata` | POST | `{field, value}` → `{state_id}` |
| `/api/bug/:id/star` | POST | `{value: true\|false}` |
| `/api/bug/:id/upvote` | POST | `{value: true\|false}` |

### Creating a bug

```json
{
  "component_id": 2,
  "template_name": "",
  "title": "Widget fails to render",
  "description": "Markdown body",
  "collaborators": [],
  "cc": []
}
```

`type`, `priority`, `severity`, `assignee` and `verifier` are optional. Needs
`CreateIssues` on the component. Returns the new numeric id.

### Updating metadata

One field per call:

```json
{ "field": "status", "value": "Fixed" }
```

Accepted: `status`, `priority`, `severity`, `assignee`, `type`, `title`, `description`,
`verifier`, and the list fields `collaborators`, `cc`, `full_access`, `comment_access`,
`view_access` — the lists are comma-separated in `value`. **Requires Full access.**

### Starring and +1

```json
{ "value": true }
```

These need only **View** access, unlike everything else that writes to a bug. They record
who is interested rather than changing what the bug says, so requiring edit rights would
make them useless to most readers. Idempotent, and a no-op leaves `state_id` untouched.

---

## 8. Search

`GET /api/bug_list?q=<query>`. Terms are `keyword:value`, `-` negates, commas make an OR
within one keyword, quotes group a phrase, and `/…/` is a case-insensitive regex.

| Keyword | Matches |
|---|---|
| `id`, `status`, `priority`, `severity`, `type` | Those fields |
| `assignee`, `reporter`, `verifier` | Single-user fields |
| `cc`, `collaborator` | List fields |
| `componentid` | The owning component |
| `starred`, `upvoted` | Who starred / upvoted it |
| `involves` | Reporter **or** assignee **or** verifier **or** collaborator **or** cc |

Two rules that surprise people:

- **Different keywords are ANDed**; multiple values for the *same* keyword are ORed. So
  `assignee:alice,bob` is "alice or bob", but `assignee:alice reporter:alice` is
  "assignee **and** reporter".
- **Matching is substring**, so `assignee:bob` also matches `bobby`. Use `/^bob$/` for an
  exact match.

`involves:` exists because there is no cross-field OR — "any bug I am on" cannot be built
out of the single-field keywords.

Unknown keywords match nothing on an include and everything on an exclude.

⚠️ `bug_list` walks the whole data directory and resolves component metadata per bug on
every request. It is unindexed; do not poll it hard.

---

## 9. A worked example

```bash
BASE=http://localhost:9000

# 1. Log in.
LOGIN=$(curl -sX POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$PASSWORD"'"}')
TOKEN=$(echo "$LOGIN" | jq -r .access_token)

# If must_change_password is true, everything else will 403 until you rotate.
echo "$LOGIN" | jq .must_change_password

# 2. Mint a long-lived API token so the script need not hold a password.
API_TOKEN=$(curl -sX POST "$BASE/api/auth/tokens" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{}' | jq -r .token)

# 3. Find a component to file against.
COMPONENT=$(curl -s "$BASE/api/component_list" \
  -H "Authorization: Bearer $API_TOKEN" | jq '.[0].id')

# 4. File a bug.
BUG=$(curl -sX POST "$BASE/api/create_bug" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"component_id\":$COMPONENT,\"template_name\":\"\",\"title\":\"From a script\",
       \"description\":\"body\",\"collaborators\":[],\"cc\":[]}")

# 5. Comment on it. The author is the token holder; there is no author field.
curl -sX POST "$BASE/api/bug/$BUG/comment" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"Reproduced on main."}'

# 6. Poll cheaply: fetch the whole bug only when state_id moves.
curl -s "$BASE/api/bug/$BUG/state" -H "Authorization: Bearer $API_TOKEN"
# {"state_id":"2n"}   <- note the n suffix
```

To run that as a **bot** instead — narrower than you, and explicitly granted — create one
with `POST /api/auth/bots`, then add its `identity` to the component's
`Issue Contributors` group. Until you do, it sees nothing at all.

---

## 10. CLI

`md-bug-cli` drives the same API without a browser:

```bash
# Against a running server (needs a token):
md-bug-cli --remote localhost:9000 --token "$API_TOKEN" --component_list '{}'

# Against a data directory, no server:
md-bug-cli --root ./bug-data --user admin --component_list '{}'
```

`--remote` also reads `MD_BUG_TOKEN`. `--root` mode skips token checks entirely and takes
`--user` — not an escalation, since anyone who can run it already has the files the ACLs
protect. Any `"u"` key left in the legacy JSON payloads is ignored.
