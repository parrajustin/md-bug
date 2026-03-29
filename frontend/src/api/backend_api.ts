import type { Result } from 'standard-ts-lib/src/result';
import { StatusError, InternalError } from 'standard-ts-lib/src/status_error';
import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import type { API, Bug, BugSummary } from './api';

const BACKEND_URL = 'http://localhost:9000';

export class BackendApi implements API {
  async get_bug_list(query?: string): Promise<Result<BugSummary[], StatusError>> {
    const url = new URL(`${BACKEND_URL}/api/bug_list`);
    if (query) url.searchParams.append('q', query);
    
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        return resp.json();
      }),
      'Failed to fetch bug list'
    );
  }

  async get_bug(id: number): Promise<Result<Bug, StatusError>> {
    return WrapPromise(
      fetch(`${BACKEND_URL}/api/bug/${id}`).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const data = await resp.json();
        // Convert fields to BigInt if necessary
        if (data.metadata) {
          data.metadata.createdAt = BigInt(data.metadata.created_at);
          data.metadata.stateId = BigInt(data.metadata.state_id);
          data.metadata.userMetadata = data.metadata.user_metadata;
        }
        if (data.comments) {
          data.comments.forEach((c: any) => {
            c.epochNanoseconds = BigInt(c.epoch_nanoseconds);
          });
        }
        return data as Bug;
      }),
      `Failed to fetch bug ${id}`
    );
  }

  async submit_comment(id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>> {
    return WrapPromise(
      fetch(`${BACKEND_URL}/api/bug/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, content })
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const data = await resp.json();
        return {
          commentId: data.comment_id,
          stateId: BigInt(data.state_id)
        };
      }),
      'Failed to submit comment'
    );
  }

  async change_metadata(id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>> {
    return WrapPromise(
      fetch(`${BACKEND_URL}/api/bug/${id}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value })
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const data = await resp.json();
        return {
          stateId: BigInt(data.state_id)
        };
      }),
      'Failed to change metadata'
    );
  }
}
