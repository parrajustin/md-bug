import { type Result, Ok } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import { BackendApi } from './backend_api';

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

let api_singleton: API | undefined = undefined;

export function get_api(): Result<API, StatusError> {
  if (!api_singleton) {
    api_singleton = new BackendApi();
  }
  return Ok(api_singleton);
}

export function inject_api(api: API): void {
  api_singleton = api;
}
