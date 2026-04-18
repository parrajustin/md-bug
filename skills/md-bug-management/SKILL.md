---
name: md-bug-management
description: Manage bugs, components, and templates using the md-bug-cli. Use when Gemini CLI needs to interact with the md-bug backend through the CLI to list, create, or update bugs and communicate with users via bug comments.
---

# Md Bug Management

## Overview

This skill enables Gemini CLI to use the `md-bug-cli` tool to interact with the `md-bug` backend directly from the command line. It provides a structured way to manage the bug lifecycle, navigate component hierarchies, and maintain communication with users through bug comments.

## Setup & Defaults

- **Binary Location**: `md-bug/backend/target/debug/md-bug-cli`
- **Data Root**: `md-bug/backend/bug-data/`
- **User Identification**: Always include the `"u": "username"` field in JSON payloads to represent the acting user.

## Workflow Decision Tree

1. **Need to find where to put a bug?** → `--component_list` to see available components.
2. **Need to find existing bugs?** → `--bug_list` with search terms.
3. **Need more details on a bug?** → `--bug <id> --get_bug` to read metadata and comments.
4. **Need to report an issue?** → `--create_bug` with component ID and details.
5. **Need to talk to the user/reporter?** → `--bug <id> --submit_comment` to add a message.
6. **Need to change status/assignee?** → `--bug <id> --update_bug_metadata` with the field and value.

## Task Reference

See [cli-payloads.md](references/cli-payloads.md) for full JSON request structures.

### 1. Listing & Searching
- **List all components**:
  `md-bug-cli --root md-bug/backend/bug-data/ --component_list '{"u": "admin"}'`
- **List bugs with search**:
  `md-bug-cli --root md-bug/backend/bug-data/ --bug_list '{"q": "crash", "u": "admin"}'`

### 2. Bug Lifecycle
- **Create a new bug**:
  `md-bug-cli --root md-bug/backend/bug-data/ --create_bug '{"u": "admin", "component_id": 1, "title": "...", "description": "..."}'`
- **Update status to Fixed**:
  `md-bug-cli --root md-bug/backend/bug-data/ --bug 123 --update_bug_metadata '{"field": "status", "value": "Fixed", "u": "admin"}'`

### 3. Communication & Feedback
- **Ask a question or provide update**:
  `md-bug-cli --root md-bug/backend/bug-data/ --bug 123 --submit_comment '{"u": "admin", "author": "admin", "content": "I have fixed the issue in PR #45. Please verify."}'`
- **Check for user responses**:
  `md-bug-cli --root md-bug/backend/bug-data/ --bug 123 --get_bug '{"u": "admin"}'` (Check the `comments` list in the response).

## Example Usage

```bash
# List components
md-bug-cli --root md-bug/backend/bug-data/ --component_list '{"u": "admin"}'

# Create a component (parent_id 1 is usually 'All' root)
md-bug-cli --root md-bug/backend/bug-data/ --create_component '{"u": "admin", "name": "New_Component", "description": "Test Component", "parent_id": 1}'

# Create a bug in component 10
md-bug-cli --root md-bug/backend/bug-data/ --create_bug '{"u": "admin", "component_id": 10, "template_name": "", "title": "Bug Title", "description": "Bug Description", "collaborators": [], "cc": []}'

# Submit a comment to bug 123
md-bug-cli --root md-bug/backend/bug-data/ --bug 123 --submit_comment '{"author": "admin", "content": "This is a comment.", "u": "admin"}'
```

## Communication Guidelines

When "talking" through bugs:
1. **Be Concise**: Keep comments brief and informative.
2. **Use Markdown**: Leverage Markdown for better readability of code snippets or logs in comments.
3. **Identity**: Clearly state your identity or the context if it's not obvious from the `author` field.
4. **Proactive Updates**: Comment when you start working, when you encounter a blocker, and when you finish a task.
5. **Request Feedback**: Use the `submit_comment` tool specifically to ask the user for confirmation or more details.
