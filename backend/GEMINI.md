# Backend Documentation & Developer Notes

This document captures the architectural decisions, conventions, and "tribal knowledge" established during the development of the `md-bug` backend.

## Architecture Overview

### Data Persistence
- **Markdown + Binary:** While the system is "Markdown-first" for human readability, metadata and structured content (like comments) are persisted using **rkyv** for high-performance zero-copy deserialization.
- **Hierarchical Components:** Components are represented directly by the filesystem directory structure.
- **Component Metadata:** Each component folder may contain a `component_metadata` file. This file defines the component's name, description, and access control rules.
- **Inheritance:** Component metadata is hierarchical. The `resolve_component_metadata` function traverses from the root to the target component, merging metadata files. Values defined in child components overwrite those from parents.

### Access Control System
- **Permission Levels:** We use a granular permission system defined by the `Permission` enum (`ComponentAdmin`, `CreateIssues`, `AdminIssues`, `EditIssues`, `CommentOnIssues`, `ViewIssues`).
- **Groups:** Permissions are managed via groups in `AccessControl`. Each group has a set of permissions, a `view_level` (for UI filtering), and a list of members.
- **Public Access:** The special keyword `PUBLIC` can be added to any group's member list to grant those permissions to all users.
- **Component Administration:** `ComponentAdmin` permission allows managing the component itself (metadata, templates, sub-components) but does **NOT** grant any permissions on bugs within that component.
- **Admin Overrides:** Users with `AdminIssues` or `EditIssues` permissions on a component automatically receive `Full` access to all bugs within that component hierarchy.
- **Reporter Access:** When a bug is created, the reporter is explicitly added to the bug's `full_access` list. This grants them initial full control, but they can be removed from this list by another user with full access. Being a reporter does **NOT** grant implicit or permanent access.
- **Tiered Access:** Permissions are strictly linear: `Full Access` > `Comment Access` > `View Access`. Users with `Comment` access implicitly have `View` access. Users with `Full` access implicitly have both.

### Bug ID Management
- **BugIdCache:** To avoid expensive full-disk scans, the `BugIdCache` maintains a mapping of Bug IDs to their component paths and tracks the next available Bug and Comment IDs.
- **Location:** The cache implementation resides in `backend/src/bug_id_cache.rs`.
- **Integrity:** Folder names that are purely numeric are treated as Bug IDs. Components (folders) cannot have purely numeric names.

### Bug Content
- **Description:** The bug's initial description is stored directly within `BugMetadata` and NOT as a separate comment. 
- **Comments:** Comments are sequential updates to the bug, stored as individual files (e.g., `comment_0000001`). The first comment is NOT the description.

## Conventions & Standards

### Error Handling
- **No Unwraps:** Unsafe `.unwrap()` calls are strictly banned. Always use `match`, `if let`, or the `?` operator.
- **StatusCode:** API handlers should return `Result<impl IntoResponse, StatusCode>` to ensure proper HTTP error signaling.

### API Design
- **State Identification:** Every bug and component has a `state_id` (represented as `u64` in Rust, `bigint` in TS). This must be incremented on every modification to support frontend caching and optimistic concurrency.
- **Username Requirement:** Most API calls require a `u` (username) parameter for access control enforcement.
- **Root Protection (STRICT):** Creation of components at the absolute root via the API is **STRICTLY FORBIDDEN**. NO BOOTSTRAP LOGIC IS ALLOWED IN THE API TO CIRCUMVENT THIS. Root components must be bootstrapped via manual disk configuration (creating the folder and `component_metadata` file manually). Any attempt to create a component with `parent_id` 0 or equivalent via the API must be rejected.
- **NO ROOT CREATION:** To be clear, the API must NEVER create a component at the root. Root components are strictly manual.
- **STRICT FORBIDDEN:** Creating components at the root level via the API is strictly banned. NO EXCEPTIONS.
- **MANUAL ONLY:** Root components must be created by an administrator directly on the server's filesystem.

### Serialization (The "n" Suffix)
- Rust `u64` fields are serialized to JSON as strings with an "n" suffix (e.g., `"123n"`).
- **Frontend Compatibility:** The frontend uses `bigIntReviver` and `bigIntReplacer` to seamlessly convert these to/from JavaScript `BigInt`.

## Developer Memories

- **Stable Scrolling:** When linking to specific comments, the frontend uses a retry loop with `requestAnimationFrame` to ensure the DOM is rendered before attempting to `scrollIntoView`.
- **Sanitization:** Component names provided via API are sanitized to lowercase alphanumeric strings with underscores. If a collision occurs on disk (even if the display names differ), a numeric suffix is appended.
- **Group Inheritance:** When creating a sub-component, all `access_control.groups` from the parent are cloned. The creator is then explicitly added to the "Component Admins" group of the new child.

## Verification
- **Unit Tests:** Always run `cargo test` within the `backend/` directory to verify core logic, ID management, and API handler integrity. This is a foundational mandate for every backend change.
- **Integration Tests:** After verifying with unit tests, run `npm test` in the `integration_tests/` directory to ensure full-stack compatibility.
