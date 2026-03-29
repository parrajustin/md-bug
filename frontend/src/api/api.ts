import { type Result, Ok } from 'standard-ts-lib/src/result';
import { Some, None, type Optional } from "standard-ts-lib/src/optional";
import { StatusError } from 'standard-ts-lib/src/status_error';
import { BackendApi } from './backend_api';
import { FakeApi } from './fake_api';

declare const USE_FAKE_API: boolean;

// Default value if not defined by esbuild
const use_fake = typeof USE_FAKE_API !== 'undefined' ? USE_FAKE_API : false;

export interface UserMetadataEntry {
  key: string;
  value: string;
  type: string;
}

export interface BugMetadata {
  id: number;
  reporter: string;
  type: string;
  priority: string;
  severity: string;
  status: string;
  assignee: string;
  title: string;
  folders: string[];
  userMetadata: UserMetadataEntry[];
  createdAt: bigint;
}

export interface Comment {
  id: number;
  author: string;
  epochNanoseconds: bigint;
  content: string;
}

export interface Bug {
  id: number;
  title: string;
  folders: string[];
  metadata: BugMetadata;
  comments: Comment[];
}

export interface BugSummary {
  id: number;
  title: string;
}

export interface API {
  get_bug_list(query?: string): Promise<Result<BugSummary[], StatusError>>;
  get_bug(id: number): Promise<Result<Bug, StatusError>>;
  submit_comment(id: number, author: string, content: string): Promise<Result<void, StatusError>>;
  change_metadata(id: number, field: string, value: string): Promise<Result<void, StatusError>>;
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
