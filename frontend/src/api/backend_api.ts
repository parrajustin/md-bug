import type { Result } from 'standard-ts-lib/src/result';
import { StatusError, InternalError } from 'standard-ts-lib/src/status_error';
import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import { type API, type Bug, type BugSummary, type SubmitCommentResponse, type ChangeMetadataResponse, bigIntReviver, bigIntReplacer } from './api';

const BACKEND_URL = 'http://localhost:9000';

export class BackendApi implements API {
  async get_bug_list(username: string, query?: string): Promise<Result<BugSummary[], StatusError>> {
    const url = new URL(`${BACKEND_URL}/api/bug_list`);
    url.searchParams.append('u', username);
    if (query) url.searchParams.append('q', query);
    
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver);
      }),
      'Failed to fetch bug list'
    );
  }

  async get_bug(username: string, id: number): Promise<Result<Bug, StatusError>> {
    const url = new URL(`${BACKEND_URL}/api/bug/${id}`);
    url.searchParams.append('u', username);
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as Bug;
      }),
      `Failed to fetch bug ${id}`
    );
  }

  async get_bug_state(username: string, id: number): Promise<Result<bigint, StatusError>> {
    const url = new URL(`${BACKEND_URL}/api/bug/${id}/state`);
    url.searchParams.append('u', username);
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        const json = JSON.parse(text, bigIntReviver);
        return json.state_id;
      }),
      `Failed to fetch state for bug ${id}`
    );
  }

  async submit_comment(username: string, id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>> {
    return WrapPromise(
      fetch(`${BACKEND_URL}/api/bug/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, content, u: username }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as SubmitCommentResponse;
      }),
      'Failed to submit comment'
    );
  }

  async change_metadata(username: string, id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>> {
    return WrapPromise(
      fetch(`${BACKEND_URL}/api/bug/${id}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value, u: username }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as ChangeMetadataResponse;
      }),
      'Failed to change metadata'
    );
  }
}
