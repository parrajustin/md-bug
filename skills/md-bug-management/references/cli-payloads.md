# md-bug CLI Payload Reference

This document provides the JSON schemas for various `md-bug-cli` operations. All payloads must be valid JSON strings.

## User Identification
Most operations require a `u` field for the username.
- Default: `{"u": "anonymous"}`

## Bug Operations

### List Bugs (`--bug_list`)
Optional JSON string.
```json
{
  "q": "search term",
  "u": "username"
}
```

### Create Bug (`--create_bug`)
```json
{
  "u": "username",
  "component_id": 123,
  "template_name": "",
  "title": "Bug Title",
  "description": "Markdown description",
  "type": "Bug",
  "priority": "P2",
  "severity": "S2",
  "assignee": "username",
  "verifier": "username",
  "collaborators": ["user1", "user2"],
  "cc": ["user3"]
}
```

### Get Bug (`--get_bug`)
Needs `--bug <id>`.
```json
{
  "u": "username"
}
```

### Submit Comment (`--submit_comment`)
Needs `--bug <id>`.
```json
{
  "author": "username",
  "u": "username",
  "content": "Markdown comment content"
}
```

### Update Bug Metadata (`--update_bug_metadata`)
Needs `--bug <id>`.
```json
{
  "field": "status",
  "value": "Fixed",
  "u": "username"
}
```
Supported fields: `status`, `priority`, `severity`, `assignee`, `type`, `title`, `description`, `collaborators`, `cc`, `verifier`, `full_access`, `comment_access`, `view_access`.

## Component Operations

### List Components (`--component_list`)
```json
{
  "u": "username"
}
```

### Create Component (`--create_component`)
```json
{
  "u": "username",
  "name": "Component_Name",
  "description": "Description",
  "parent_id": 1
}
```

### Get Component Metadata (`--get_component_metadata`)
Needs `--component <id>`.
```json
{
  "u": "username"
}
```

### Update Component Metadata (`--update_component_metadata`)
Needs `--component <id>`.
```json
{
  "u": "username",
  "metadata": { ...ComponentMetadata... }
}
```

## Template Operations (Needs `--component <id>`)

### Add Template (`--add_template`)
```json
{
  "u": "username",
  "template": {
    "name": "Template_Name",
    "description": "Desc",
    "title": "Default Title",
    "collaborators": [],
    "cc": [],
    "default_access": "Default"
  }
}
```

### Modify Template (`--modify_template`)
```json
{
  "u": "username",
  "old_name": "Old_Name",
  "template": { ...BugTemplate... }
}
```

### Delete Template (`--delete_template`)
```json
{
  "u": "username",
  "name": "Template_Name"
}
```
