import { type Result, Ok } from 'standard-ts-lib/src/result';
import { Some, None, type Optional } from "standard-ts-lib/src/optional";
import { StatusError } from 'standard-ts-lib/src/status_error';
import { BackendApi } from './backend_api';
import { FakeApi } from './fake_api';

declare const USE_FAKE_API: boolean;

// Default value if not defined by esbuild
const use_fake = typeof USE_FAKE_API !== 'undefined' ? USE_FAKE_API : false;

export type Permission = 
  | 'ComponentAdmin'
  | 'CreateIssues'
  | 'AdminIssues'
  | 'EditIssues'
  | 'CommentOnIssues'
  | 'ViewIssues';

export type TemplateAccess = 
  | 'Default'
  | 'LimitedComment'
  | 'LimitedView';

export interface UserMetadataEntry {
  version: number;
  key: string;
  value: string;
  type: string;
}

export interface AccessMetadata {
  version: number;
  full_access: string[];
  comment_access: string[];
  view_access: string[];
}

export interface BugTemplate {
  name: string;
  description: string;
  title: string;
  type?: string;
  priority?: string;
  severity?: string;
  hotlist?: string;
  assignee?: string;
  verifier?: string;
  collaborators: string[];
  cc: string[];
  comment?: string;
  default_access: TemplateAccess;
}

export interface GroupPermissions {
  permissions: Permission[];
  view_level: number;
  members: string[];
}

export interface AccessControl {
  groups: { [name: string]: GroupPermissions };
}

export interface ComponentMetadata {
  version: number;
  id: number;
  name: string;
  description: string;
  creator: string;
  bug_type?: string;
  priority?: string;
  severity?: string;
  verifier?: string;
  collaborators: string[];
  cc: string[];
  access_control: AccessControl;
  templates: { [name: string]: BugTemplate };
  default_template: string;
  user_metadata: UserMetadataEntry[];
  created_at: bigint;
}

export interface BugMetadata {
  version: number;
  id: number;
  reporter: string;
  type: string;
  priority: string;
  severity: string;
  status: string;
  assignee: string;
  verifier: string;
  collaborators: string[];
  cc: string[];
  access: AccessMetadata;
  title: string;
  component_id: number;
  description: string;
  user_metadata: UserMetadataEntry[];
  created_at: bigint;
  state_id: bigint;
  /// Usernames who starred the bug. A personal bookmark; any viewer can add themselves.
  starred_by: string[];
  /// Usernames who upvoted it; the count is this array's length.
  upvoted_by: string[];
}

export interface Comment {
  version: number;
  id: number;
  author: string;
  epoch_nanoseconds: bigint;
  content: string;
}

export interface Bug {
  id: number;
  title: string;
  folders: string[];
  folder_ids: number[];
  metadata: BugMetadata;
  comments: Comment[];
  state_id: bigint;
}

export interface BugSummary {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  severity: string;
  type: string;
  created_at: bigint;
  last_updated_at: bigint;
}

export interface ComponentSummary {
  id: number;
  name: string;
  description: string;
  folders: string[];
  parent_id: number;
  /// Who created it. Ownership is `creator` rather than "is a Component Admin" because
  /// admin rights inherit down the tree and PUBLIC matches everyone, so an admin check
  /// would report whole subtrees instead of what you made.
  creator: string;
}

export interface CreateBugRequest {
  component_id: number;
  template_name: string;
  title: string;
  description: string;
  type?: string;
  priority?: string;
  severity?: string;
  assignee?: string;
  verifier?: string;
  collaborators: string[];
  cc: string[];
}

export interface CreateRootComponentRequest {
  name: string;
  description: string;
}

export interface CreateComponentRequest {
  name: string;
  description: string;
  parent_id: number;
}

export function bigIntReplacer(_key: string, value: any): any {
  if (typeof value === "bigint") {
    return value.toString() + 'n';
  }
  return value;
}

/**
 * Reviver for JSON.parse that handles u64 fields from the backend.
 * It only targets fields known to be u64 to avoid accidental conversion of 
 * string content (e.g., in comments) that might look like "100n".
 */
export function bigIntReviver(key: string, value: any): any {
  const isBigIntField = 
    key === 'created_at' || 
    key === 'last_updated_at' ||
    key === 'state_id' || 
    key === 'epoch_nanoseconds';

  if (isBigIntField) {
    if (typeof value === 'string') {
      if (value.endsWith('n')) {
        const numericPart = value.slice(0, -1);
        if (/^\d+$/.test(numericPart)) {
          return BigInt(numericPart);
        }
      }
      // If it's a numeric string without 'n', still convert to BigInt for consistency
      if (/^\d+$/.test(value)) {
        return BigInt(value);
      }
    } else if (typeof value === 'number') {
      return BigInt(value);
    }
  }
  return value;
}

export interface SubmitCommentResponse {
  comment_id: number;
  state_id: bigint;
}

export interface BugStateResponse {
  state_id: bigint;
}

export interface ChangeMetadataResponse {
  state_id: bigint;
}

export type UserAccessLevel = 'None' | 'View' | 'Comment' | 'Full';

/// The bug/component API.
///
/// No method takes a username: identity is carried by the bearer token attached in
/// `BackendApi.request`. A client-supplied username was spoofable and is now rejected
/// by the backend outright.
export interface API {
  get_bug_list(query?: string): Promise<Result<BugSummary[], StatusError>>;
  get_bug(id: number): Promise<Result<Bug, StatusError>>;
  get_bug_state(id: number): Promise<Result<BugStateResponse, StatusError>>;
  /// Adds or removes the caller from a bug's star list. Needs only View access.
  set_bug_star(id: number, value: boolean): Promise<Result<ChangeMetadataResponse, StatusError>>;
  set_bug_upvote(id: number, value: boolean): Promise<Result<ChangeMetadataResponse, StatusError>>;
  submit_comment(id: number, content: string): Promise<Result<SubmitCommentResponse, StatusError>>;
  update_bug_metadata(id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>>;
  get_component_metadata(id: number): Promise<Result<ComponentMetadata, StatusError>>;
  update_component_metadata(id: number, metadata: ComponentMetadata): Promise<Result<void, StatusError>>;
  get_component_list(): Promise<Result<ComponentSummary[], StatusError>>;
  add_template(id: number, template: BugTemplate): Promise<Result<void, StatusError>>;
  modify_template(id: number, old_name: string, template: BugTemplate): Promise<Result<void, StatusError>>;
  delete_template(id: number, name: string): Promise<Result<void, StatusError>>;
  create_component(request: CreateComponentRequest): Promise<Result<void, StatusError>>;
  /// Admin-only. Root components have no parent to inherit permissions from, so this is
  /// a separate endpoint from `create_component`, which still rejects `parent_id: 0`.
  create_root_component(request: CreateRootComponentRequest): Promise<Result<number, StatusError>>;
  create_bug(request: CreateBugRequest): Promise<Result<number, StatusError>>;
}

let api_singleton: Optional<API> = None;

export function get_api(): Result<API, StatusError> {
  if (api_singleton.none) {
    if (use_fake) {
      api_singleton = Some(new FakeApi());
    } else {
      api_singleton = Some(new BackendApi());
    }
  }
  return Ok(api_singleton.safeValue());
}

export function inject_api(api: API): void {
  api_singleton = Some(api);
}

/// Where the API lives.
///
/// The backend serves the built frontend itself, so in a browser the API is always the
/// page's own origin. Hardcoding a port broke any deployment not on 9000 — and, because
/// no CORS layer is installed, did so with an opaque network error rather than a useful
/// status. The localhost fallback is only for non-browser callers such as tests and the
/// integration suite.
export function defaultBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:9000';
}
