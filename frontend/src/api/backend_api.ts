import type { Result } from 'standard-ts-lib/src/result';
import { StatusError, InternalError } from 'standard-ts-lib/src/status_error';
import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import { type API, type Bug, type BugSummary, type SubmitCommentResponse, type ChangeMetadataResponse, type BugStateResponse, type ComponentMetadata, type BugTemplate, type CreateComponentRequest, type CreateBugRequest, bigIntReviver, bigIntReplacer } from './api';

export class BackendApi implements API {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:9000') {
    this.baseUrl = baseUrl;
  }

  async get_bug_list(username: string, query?: string): Promise<Result<BugSummary[], StatusError>> {
    const url = new URL(`${this.baseUrl}/api/bug_list`);
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
    const url = new URL(`${this.baseUrl}/api/bug/${id}`);
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

  async get_bug_state(username: string, id: number): Promise<Result<BugStateResponse, StatusError>> {
    const url = new URL(`${this.baseUrl}/api/bug/${id}/state`);
    url.searchParams.append('u', username);
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as BugStateResponse;
      }),
      `Failed to fetch state for bug ${id}`
    );
  }

  async submit_comment(username: string, id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/bug/${id}/comment`, {
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
      fetch(`${this.baseUrl}/api/bug/${id}/metadata`, {
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

  async get_component_metadata(username: string, id: number): Promise<Result<ComponentMetadata, StatusError>> {
    const url = new URL(`${this.baseUrl}/api/component/${id}/get_metadata`);
    url.searchParams.append('u', username);
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as ComponentMetadata;
      }),
      'Failed to fetch component metadata'
    );
  }

  async update_component_metadata(username: string, id: number, metadata: ComponentMetadata): Promise<Result<void, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/component/${id}/update_metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: username, metadata }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
      }),
      'Failed to update component metadata'
    );
  }

  async get_component_list(username: string): Promise<Result<string[], StatusError>> {
    const url = new URL(`${this.baseUrl}/api/component_list`);
    url.searchParams.append('u', username);
    return WrapPromise(
      fetch(url.toString()).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as string[];
      }),
      'Failed to fetch component list'
    );
  }

  async add_template(username: string, id: number, template: BugTemplate): Promise<Result<void, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/component/${id}/add_template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: username, template }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
      }),
      'Failed to add template'
    );
  }

  async modify_template(username: string, id: number, old_name: string, template: BugTemplate): Promise<Result<void, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/component/${id}/modify_template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: username, old_name, template }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
      }),
      'Failed to modify template'
    );
  }

  async delete_template(username: string, id: number, name: string): Promise<Result<void, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/component/${id}/delete_template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u: username, name }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
      }),
      'Failed to delete template'
    );
  }

  async create_component(username: string, request: CreateComponentRequest): Promise<Result<void, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/create_component`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, u: username }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
      }),
      'Failed to create component'
    );
  }

  async create_bug(username: string, request: CreateBugRequest): Promise<Result<number, StatusError>> {
    return WrapPromise(
      fetch(`${this.baseUrl}/api/create_bug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, u: username }, bigIntReplacer)
      }).then(async resp => {
        if (!resp.ok) throw InternalError(`Server returned ${resp.status}`);
        const text = await resp.text();
        return JSON.parse(text, bigIntReviver) as number;
      }),
      'Failed to create bug'
    );
  }
}
