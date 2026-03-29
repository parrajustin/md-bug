# md-bug

`md-bug` is a Markdown-based bug and task tracking system designed for both human and agentic workflows. It leverages a Rust-based backend for high-performance data processing and provides a Model Context Protocol (MCP) API to enable AI agents to interact with and manage tasks autonomously.

## Core Concepts

### Bugs
A **Bug** is the fundamental unit of work. Each bug is uniquely identified by a numeric ID starting from 1.

- **Attributes (Metadata):**
  - **Reporter:** The user who created the bug.
  - **Type:** The category of the issue (e.g., Bug, Feature, Task).
  - **Priority:** P0 (highest) to P4 (lowest).
  - **Severity:** S0 (critical) to S4 (minor).
  - **Status:** Current state (e.g., New, Assigned, Fixed, Verified).
  - **Assignee:** The user or agent currently responsible for the bug.
- **Relationships:**
  - **Parent/Child:** Used for task decomposition.
  - **Blocking:** Tracks dependencies between bugs.
- **Content:** A bug consists of a series of **Comments** and arbitrary data attributes.

### Components (Folders)
Bugs are organized into a hierarchical structure called **Components** or **Folders**.
- **Hierarchy:** `Company Name > Parent Team > Team Name > Project Name > Task`

### Comments
Comments build the bug's history. Each comment has:
- **Author:** The user or agent who made the comment.
- **Date:** Timestamp of the comment.
- **Content:** Markdown-formatted text.
- **ID:** A sequential number based on server receipt order.

## Architecture

- **Backend (Rust):**
  - Responsible for core logic, ID generation, and markdown persistence.
  - Exposes an **MCP API** for agentic interaction.
- **Frontend (React + TypeScript):**
  - Located in `md-bug/frontend`.
  - Uses `marked` for markdown rendering and `dompurify` for security.
  - Features a side panel for navigation and a main content area for bug details and metadata.
- **Data Persistence:**
  - **Markdown-First:** All data is stored in human-readable markdown files, ensuring portability and auditability.

## Project Structure

```text
md-bug/
├── frontend/             # React frontend
│   ├── src/
│   │   ├── api/          # API client and interfaces
│   │   ├── App.tsx       # Main UI logic
│   │   └── styles.css    # UI styling
├── GEMINI.md             # Project documentation (this file)
└── README.md             # Brief project overview
```

## Development Mandates

- **ID Integrity:** Bug IDs must be unique and strictly sequential.
- **Auditable History:** Every change must be captured in the bug's comment history.
- **Agent-First Design:** The MCP API is a primary interface; ensure agents have full context for autonomous work.
- **Security:** Always sanitize markdown output on the frontend using `dompurify`.
- **Utilities:** Prefer using the utility functions and patterns defined in the [Standard TS Lib](../standard-ts-lib/GEMINI.md). Always use absolute package imports (e.g., `import { ... } from 'standard-ts-lib/src/...'`) instead of relative paths for these utilities.
- **Verification:** Always verify changes to the `frontend` directory by ensuring that `npm run build` passes within the `md-bug/frontend` folder.
- **Testing:** Always keep tests in separate files (e.g., `api_test.rs`) rather than in the same file as the implementation. Use `#[cfg(test)] mod <test_file>;` to include them.
- **Error Handling:** Unsafe `.unwrap()` calls are strictly disallowed in the Rust backend. Use proper error handling patterns such as `match`, `if let`, or the `?` operator. If an error is truly impossible, use `.expect("clear explanation why this is safe")` sparingly, but prefer robust handling.


## Conventions & Style

- **Naming:** Use clear, descriptive component names.
- **Markdown:** Use standard GitHub-flavored markdown for comments.
- **Type Safety:** Maintain strict TypeScript interfaces in the frontend to match backend models.
