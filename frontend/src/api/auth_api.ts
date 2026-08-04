import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import {
  type StatusError,
  InternalError,
  InvalidArgumentError,
  UnauthenticatedError,
  PermissionDeniedError,
} from 'standard-ts-lib/src/status_error';
import { WrapPromise } from 'standard-ts-lib/src/wrap_promise';
import { WrapToResult } from 'standard-ts-lib/src/wrap_to_result';
import { storage, type StoredSession } from './storage';
import { defaultBaseUrl } from './api';

export interface LoginResult {
  session: StoredSession;
  /// When true the caller must send the user through the change-password screen before
  /// anything else will work; the backend 403s every other endpoint until they do.
  mustChangePassword: boolean;
}

interface LoginResponseBody {
  access_token: string;
  refresh_token: string;
  username: string;
  is_admin: boolean;
  must_change_password: boolean;
  expires_in: number;
}

export interface PersonalToken {
  id: number;
  label: string | null;
  /// The ACL name, e.g. `bot:ci-agent`. Null for tokens issued before identities
  /// existed, which act as their owner instead.
  identity: string | null;
  created_at: number;
}

/// Maps an HTTP status onto a `StatusError` so callers can branch on the code rather
/// than string-matching a message.
function errorForStatus(status: number, fallback: string): StatusError {
  if (status === 401) return UnauthenticatedError('Incorrect username or password');
  if (status === 403) return PermissionDeniedError('Not permitted');
  if (status === 400) return InvalidArgumentError(fallback);
  if (status === 409) return InvalidArgumentError('That username is already taken');
  return InternalError(`${fallback} (server returned ${status})`);
}

/// Client for `/api/auth/*`.
///
/// Kept separate from `BackendApi` because these are the only calls that must work
/// *without* a valid access token — that is the whole point of them.
export class AuthApi {
  private readonly baseUrl: string;

  constructor(baseUrl: string = defaultBaseUrl()) {
    this.baseUrl = baseUrl;
  }

  private async postJson(
    path: string,
    body: unknown,
    token?: string
  ): Promise<Result<Response, StatusError>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return WrapPromise(
      fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      `Request to ${path} failed`
    );
  }

  async login(username: string, password: string): Promise<Result<LoginResult, StatusError>> {
    const response = await this.postJson('/api/auth/login', { username, password });
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) {
      return Err(errorForStatus(resp.status, 'Login failed'));
    }

    const parsed = await WrapPromise(resp.json(), 'Malformed login response');
    if (parsed.err) return parsed;
    const body = parsed.safeUnwrap() as LoginResponseBody;

    return Ok({
      session: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        username: body.username,
        isAdmin: body.is_admin,
      },
      mustChangePassword: body.must_change_password,
    });
  }

  /// Exchanges a refresh token for a new pair. The server rotates on use, so the old
  /// refresh token is dead once this returns.
  async refresh(refreshToken: string): Promise<Result<LoginResult, StatusError>> {
    const response = await this.postJson('/api/auth/refresh', { refresh_token: refreshToken });
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) {
      return Err(errorForStatus(resp.status, 'Session refresh failed'));
    }

    const parsed = await WrapPromise(resp.json(), 'Malformed refresh response');
    if (parsed.err) return parsed;
    const body = parsed.safeUnwrap() as LoginResponseBody;

    return Ok({
      session: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        username: body.username,
        isAdmin: body.is_admin,
      },
      mustChangePassword: body.must_change_password,
    });
  }

  /// Authenticated by the *current password*, not a bearer token — an account under
  /// forced rotation is rejected by every token-authenticated endpoint, so this is the
  /// only way out of that state.
  async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string
  ): Promise<Result<void, StatusError>> {
    const response = await this.postJson('/api/auth/change_password', {
      username,
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) {
      if (resp.status === 400) {
        return Err(
          InvalidArgumentError(
            'Password must be at least 8 characters and different from the current one'
          )
        );
      }
      return Err(errorForStatus(resp.status, 'Could not change password'));
    }
    return Ok(undefined);
  }

  async logout(accessToken: string): Promise<Result<void, StatusError>> {
    const response = await this.postJson('/api/auth/logout', {}, accessToken);
    if (response.err) return response;
    return Ok(undefined);
  }

  async createUser(
    accessToken: string,
    username: string,
    password: string,
    isAdmin: boolean
  ): Promise<Result<void, StatusError>> {
    const response = await this.postJson(
      '/api/auth/users',
      { username, password, is_admin: isAdmin },
      accessToken
    );
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) return Err(errorForStatus(resp.status, 'Could not create user'));
    return Ok(undefined);
  }

  async listPersonalTokens(accessToken: string): Promise<Result<PersonalToken[], StatusError>> {
    const response = await WrapPromise(
      fetch(`${this.baseUrl}/api/auth/tokens`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      'Could not list tokens'
    );
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) return Err(errorForStatus(resp.status, 'Could not list tokens'));

    const parsed = await WrapPromise(resp.json(), 'Malformed token list');
    if (parsed.err) return parsed;
    return Ok(parsed.safeUnwrap() as PersonalToken[]);
  }

  /// Creates a bot token. The name is generated server-side as
  /// `<username>--<word>_<word>_<word>`, so there is nothing to pass.
  ///
  /// Returns the identity and the plaintext token. This is the only time the server will
  /// ever reveal the secret.
  async createPersonalToken(
    accessToken: string
  ): Promise<Result<{ identity: string; token: string }, StatusError>> {
    const response = await this.postJson('/api/auth/tokens', {}, accessToken);
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) return Err(errorForStatus(resp.status, 'Could not create token'));

    const parsed = await WrapPromise(resp.json(), 'Malformed token response');
    if (parsed.err) return parsed;
    const body = parsed.safeUnwrap() as { identity: string; token: string };
    return Ok({ identity: body.identity, token: body.token });
  }

  async revokePersonalToken(
    accessToken: string,
    id: number
  ): Promise<Result<void, StatusError>> {
    const response = await WrapPromise(
      fetch(`${this.baseUrl}/api/auth/tokens/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      'Could not revoke token'
    );
    if (response.err) return response;

    const resp = response.safeUnwrap();
    if (!resp.ok) return Err(errorForStatus(resp.status, 'Could not revoke token'));
    return Ok(undefined);
  }
}

export const authApi = new AuthApi();

/// The access token used by `BackendApi` for outgoing requests.
///
/// Held in a module-level variable rather than read from IndexedDB per request: the API
/// client's methods are hot, and an async storage read on every call would serialise
/// them behind the DB.
let activeSession: StoredSession | null = null;

export function setActiveSession(session: StoredSession | null): void {
  activeSession = session;
}

export function getActiveSession(): StoredSession | null {
  return activeSession;
}

/// Loads any persisted session into memory. Called once at startup.
export async function restoreSession(): Promise<Result<StoredSession | null, StatusError>> {
  const stored = await storage.getSession();
  if (stored.err) return stored;

  const optional = stored.safeUnwrap();
  if (optional.none) {
    activeSession = null;
    return Ok(null);
  }

  activeSession = optional.safeValue();
  return Ok(activeSession);
}

export async function persistSession(session: StoredSession): Promise<void> {
  activeSession = session;
  await storage.setSession(session);
}

export async function clearSession(): Promise<void> {
  activeSession = null;
  await storage.clearSession();
}

/// Called by `BackendApi` when a request comes back 401. Rotates the refresh token and
/// updates the stored session, so the caller can retry once.
///
/// Concurrent 401s share a single in-flight refresh: without this, several parallel
/// requests would each redeem the refresh token, and since the server rotates on use all
/// but the first would fail and log the user out.
let inFlightRefresh: Promise<boolean> | null = null;

export function refreshActiveSession(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const current = activeSession;
    if (!current) return false;

    const refreshed = await authApi.refresh(current.refreshToken);
    if (refreshed.err) {
      await clearSession();
      return false;
    }

    await persistSession(refreshed.safeUnwrap().session);
    return true;
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

/// Parses a JSON body, converting a throw into an `Err` rather than letting it escape.
export function parseJsonSafely<T>(text: string, reviver?: (k: string, v: unknown) => unknown): Result<T, StatusError> {
  return WrapToResult(
    () => JSON.parse(text, reviver as never) as T,
    'Failed to parse server response'
  );
}
