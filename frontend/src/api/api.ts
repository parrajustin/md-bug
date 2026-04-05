import { type Result, Ok } from 'standard-ts-lib/src/result';
import { Some, None, type Optional } from "standard-ts-lib/src/optional";
import { StatusError } from 'standard-ts-lib/src/status_error';
import { BackendApi } from './backend_api';
import { FakeApi } from './fake_api';

declare const USE_FAKE_API: boolean;

// Default value if not defined by esbuild
const use_fake = typeof USE_FAKE_API !== 'undefined' ? USE_FAKE_API : false;

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
  folders: string[];
  description: string;
  user_metadata: UserMetadataEntry[];
  created_at: bigint;
  state_id: bigint;
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
  metadata: BugMetadata;
  comments: Comment[];
  state_id: bigint;
}

export interface BugSummary {
  id: number;
  title: string;
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

export interface ChangeMetadataResponse {
  state_id: bigint;
}

export interface API {
  get_bug_list(username: string, query?: string): Promise<Result<BugSummary[], StatusError>>;
  get_bug(username: string, id: number): Promise<Result<Bug, StatusError>>;
  get_bug_state(username: string, id: number): Promise<Result<bigint, StatusError>>;
  submit_comment(username: string, id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>>;
  change_metadata(username: string, id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>>;
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
