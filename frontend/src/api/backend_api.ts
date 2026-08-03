import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import {
  type StatusError,
  InternalError,
  UnauthenticatedError,
  PermissionDeniedError,
  NotFoundError,
} from 'standard-ts-lib/src/status_error';
import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import { WrapToResult } from 'standard-ts-lib/src/wrap_to_result';
import {
  type API,
  type Bug,
  type BugSummary,
  type ComponentSummary,
  type SubmitCommentResponse,
  type ChangeMetadataResponse,
  type BugStateResponse,
  type ComponentMetadata,
  type BugTemplate,
  type CreateComponentRequest,
  type CreateBugRequest,
  bigIntReviver,
  bigIntReplacer,
  defaultBaseUrl,
} from './api';
import { getActiveSession, refreshActiveSession } from './auth_api';

/// Client for the bug/component API.
///
/// Every method funnels through `request`, which attaches the bearer token and retries
/// once after refreshing on a 401. Before authentication existed each method wrote its
/// own `fetch` and appended a `u=<username>` parameter; identity now comes from the
/// token, so no method takes a username.
export class BackendApi implements API {
  private readonly baseUrl: string;

  constructor(baseUrl: string = defaultBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  /// Single point where auth is attached and failures are classified.
  ///
  /// The retry is deliberately capped at one attempt: if the refresh itself fails the
  /// session is already cleared, and looping would just spin against a dead token.
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string> },
    context: string,
    parse: boolean
  ): Promise<Result<T, StatusError>> {
    const send = async (): Promise<Result<Response, StatusError>> => {
      const url = new URL(`${this.baseUrl}${path}`);
      for (const [key, value] of Object.entries(init.query ?? {})) {
        url.searchParams.append(key, value);
      }

      const headers: Record<string, string> = {};
      const session = getActiveSession();
      if (session) headers['Authorization'] = `Bearer ${session.accessToken}`;
      if (init.body !== undefined) headers['Content-Type'] = 'application/json';

      const serialized =
        init.body === undefined
          ? undefined
          : WrapToResult(
              () => JSON.stringify(init.body, bigIntReplacer),
              'Failed to serialize request body'
            );
      if (serialized?.err) return serialized;

      return WrapPromise(
        fetch(url.toString(), {
          method: init.method ?? 'GET',
          headers,
          body: serialized?.safeUnwrap(),
        }),
        context
      );
    };

    let response = await send();
    if (response.err) return response;

    if (response.safeUnwrap().status === 401 && getActiveSession() !== null) {
      // The access token may simply have aged out; rotate and try once more.
      const refreshed = await refreshActiveSession();
      if (refreshed) {
        response = await send();
        if (response.err) return response;
      }
    }

    const resp = response.safeUnwrap();
    if (!resp.ok) {
      return Err(this.classify(resp.status, context));
    }

    if (!parse) return Ok(undefined as T);

    const text = await WrapPromise(resp.text(), context);
    if (text.err) return text;

    return WrapToResult(
      () => JSON.parse(text.safeUnwrap(), bigIntReviver) as T,
      `${context}: malformed response`
    );
  }

  /// Turns an HTTP status into a typed error so callers can distinguish "log back in"
  /// from "you may not do that" without parsing strings.
  private classify(status: number, context: string): StatusError {
    if (status === 401) return UnauthenticatedError('Your session has expired');
    if (status === 403) return PermissionDeniedError('You do not have access to this');
    if (status === 404) return NotFoundError(`${context}: not found`);
    return InternalError(`${context} (server returned ${status})`);
  }

  async get_bug_list(query?: string): Promise<Result<BugSummary[], StatusError>> {
    return this.request(
      '/api/bug_list',
      { query: query ? { q: query } : {} },
      'Failed to fetch bug list',
      true
    );
  }

  async get_bug(id: number): Promise<Result<Bug, StatusError>> {
    return this.request(`/api/bug/${id}`, {}, `Failed to fetch bug ${id}`, true);
  }

  async get_bug_state(id: number): Promise<Result<BugStateResponse, StatusError>> {
    return this.request(
      `/api/bug/${id}/state`,
      {},
      `Failed to fetch state for bug ${id}`,
      true
    );
  }

  /// Note there is no author parameter: the backend credits the comment to the
  /// authenticated caller, ignoring anything the client might claim.
  async submit_comment(
    id: number,
    content: string
  ): Promise<Result<SubmitCommentResponse, StatusError>> {
    return this.request(
      `/api/bug/${id}/comment`,
      { method: 'POST', body: { content } },
      'Failed to submit comment',
      true
    );
  }

  async update_bug_metadata(
    id: number,
    field: string,
    value: string
  ): Promise<Result<ChangeMetadataResponse, StatusError>> {
    return this.request(
      `/api/bug/${id}/update_metadata`,
      { method: 'POST', body: { field, value } },
      'Failed to update metadata',
      true
    );
  }

  async get_component_metadata(id: number): Promise<Result<ComponentMetadata, StatusError>> {
    return this.request(
      `/api/component/${id}/get_metadata`,
      {},
      'Failed to fetch component metadata',
      true
    );
  }

  async update_component_metadata(
    id: number,
    metadata: ComponentMetadata
  ): Promise<Result<void, StatusError>> {
    return this.request(
      `/api/component/${id}/update_metadata`,
      { method: 'POST', body: { metadata } },
      'Failed to update component metadata',
      false
    );
  }

  async get_component_list(): Promise<Result<ComponentSummary[], StatusError>> {
    return this.request('/api/component_list', {}, 'Failed to fetch component list', true);
  }

  async add_template(id: number, template: BugTemplate): Promise<Result<void, StatusError>> {
    return this.request(
      `/api/component/${id}/add_template`,
      { method: 'POST', body: { template } },
      'Failed to add template',
      false
    );
  }

  async modify_template(
    id: number,
    old_name: string,
    template: BugTemplate
  ): Promise<Result<void, StatusError>> {
    return this.request(
      `/api/component/${id}/modify_template`,
      { method: 'POST', body: { old_name, template } },
      'Failed to modify template',
      false
    );
  }

  async delete_template(id: number, name: string): Promise<Result<void, StatusError>> {
    return this.request(
      `/api/component/${id}/delete_template`,
      { method: 'POST', body: { name } },
      'Failed to delete template',
      false
    );
  }

  async create_component(request: CreateComponentRequest): Promise<Result<void, StatusError>> {
    return this.request(
      '/api/create_component',
      { method: 'POST', body: request },
      'Failed to create component',
      false
    );
  }

  async create_bug(request: CreateBugRequest): Promise<Result<number, StatusError>> {
    return this.request(
      '/api/create_bug',
      { method: 'POST', body: request },
      'Failed to create bug',
      true
    );
  }
}
