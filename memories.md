# Project Memories: md-bug

This document serves as a high-signal knowledge base for AI agents and developers ramping up on the `md-bug` project. It distills architectural patterns, technical constraints, and recent enhancements into a concise format.

## System Overview
- **Architecture:** A Markdown-first bug tracker with a Rust (Axum) backend and a React (TypeScript) frontend.
- **Persistence:** Metadata and structural data are stored in binary format using `rkyv` for performance; bug history and comments are human-readable Markdown.
- **Project Structure:**
  - `backend/`: Core logic, ID management (`BugIdCache`), and API handlers.
  - `frontend/`: React UI using a custom API client (`BackendApi`).
  - `integration_tests/`: Jest-based tests that spawn the actual binary for end-to-end validation.

## Core Mandates & Constraints
- **Root Protection:** Root components (ID 1, 2, etc., with parent 0) **MUST** be created manually on disk; the API is strictly forbidden from creating them.
- **Bug IDs:** Numeric folder names in the filesystem are reserved for Bug IDs; components cannot have purely numeric names.
- **Tiered Access:** Permissions are strictly linear: `Full Access` > `Comment Access` > `View Access`.
- **Inheritance:** Components inherit permissions from their parents unless explicitly overridden in `component_metadata`.
- **State Integrity:** Every bug has a `state_id` that increments on every write; it is the source of truth for cache invalidation.

## Permission & Access Control
- **Resolved Metadata:** Use `resolve_component_metadata` to merge the hierarchy from root to target; child settings overwrite parents.
- **Bug-Specific Overrides:**
  - `access.full_access`, `access.comment_access`, and `access.view_access` in `BugMetadata` provide per-bug granular control.
  - Users in `collaborators` automatically receive `View` access to that specific bug.
  - Users in `cc` automatically receive `View` access to that specific bug.
- **Public Access:** The keyword `PUBLIC` in any access list or group member list grants those permissions to all users (anonymous/authenticated).
- **Admin Sovereignty:** Users with `ComponentAdmin` or `AdminIssues` on a folder have `Full` access to all bugs within that subtree.

## API Patterns
- **Endpoint Naming:** Prefer descriptive POST routes like `update_metadata` for field changes and `update_bug_access` for permission modes.
- **Metadata Updates:** The `update_metadata` endpoint handles both system fields (title, status) and arbitrary `user_metadata` keys.
- **Access Modes:** `update_bug_access` supports predefined modes: `Default` (inherited), `LimitedComment` (PUBLIC can comment), and `LimitedView` (PUBLIC can view).
- **Serialization:** Rust `u64` fields are serialized as strings with an "n" suffix (e.g., `"123n"`) to support JavaScript `BigInt` via a custom reviver/replacer.

## Tips for AI Agents
- **Validation:** Always run `npm test` in `md-bug/integration_tests` after backend or API changes; the tests spawn a real server and verify the full stack.
- **Surgical Edits:** When updating `api.rs`, ensure new fields are added to the `match` arm in `change_metadata` to enable frontend updates.
- **Standard Library:** Use `standard-ts-lib` for `Result`, `Optional`, and `StatusError` in the frontend; avoid raw null checks.
- **Rust Safety:** Unsafe `.unwrap()` is banned; use `?` or `unwrap_or_else` to maintain backend stability.
- **ID Resolution:** Use the `findComponentId` helper pattern in tests to handle dynamic ID generation during setup.

## Recent Work (April 2026)
- Implemented a comprehensive suite of 11 integration tests covering permission inheritance, creator sovereignty, and sanitization collisions.
- Added `update_bug_access` to simplify per-bug permission management.
- Expanded `update_metadata` to support `title`, `description`, `collaborators`, `cc`, and `verifier`.
- Fixed tiered access logic to ensure `Comment` permission implicitly grants `View` permission.
- Verified system resilience against large (1MB+) payloads and filesystem name collisions.
