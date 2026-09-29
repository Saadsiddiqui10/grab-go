import Constants from 'expo-constants';
import { API_ERROR_MESSAGES, type ApiErrorCode, type ApiResponse, type AuthTokens, type PaginationMeta } from '@grabgo/types';
import { StorageKey, secureStorage } from '../lib/storage';

/**
 * The HTTP client.
 *
 * Three responsibilities, and nothing else:
 *
 *   1. Unwrap the API envelope so screens deal in data, not `{ ok, data }`.
 *   2. Turn every failure into an `ApiError` with a machine-readable `code`, so
 *      UI switches on codes rather than parsing message strings.
 *   3. Refresh an expired access token once, transparently, and replay the
 *      request — the customer should never be bounced to a login screen because
 *      fifteen minutes elapsed while they browsed a menu.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  realtimeUrl?: string;
};

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'http://localhost:4000/api/v1';

export const REALTIME_URL =
  process.env.EXPO_PUBLIC_REALTIME_URL ?? extra.realtimeUrl ?? 'http://localhost:4000';

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string[]> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    fields?: Record<string, string[]>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = details;
  }

  /** Copy to show the customer, preferring the shared table over server text. */
  get displayMessage(): string {
    return API_ERROR_MESSAGES[this.code] ?? this.message;
  }

  /** Whether retrying the same request could plausibly work. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'SERVICE_UNAVAILABLE';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Something went wrong. Check your connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/* ------------------------------------------------------------ token handling */

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export async function restoreTokens(): Promise<boolean> {
  const [access, refresh] = await Promise.all([
    secureStorage.get(StorageKey.accessToken),
    secureStorage.get(StorageKey.refreshToken),
  ]);

  accessToken = access;
  refreshToken = refresh;
  return Boolean(refresh);
}

export async function setTokens(tokens: AuthTokens): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;

  await Promise.all([
    secureStorage.set(StorageKey.accessToken, tokens.accessToken),
    secureStorage.set(StorageKey.refreshToken, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;

  await Promise.all([
    secureStorage.remove(StorageKey.accessToken),
    secureStorage.remove(StorageKey.refreshToken),
  ]);
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Lets the auth store react to a refresh token that has stopped working. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/**
 * Refreshing is single-flight.
 *
 * Several queries commonly fail with 401 at the same moment; without this they
 * would each rotate the refresh token, and the server's replay detection would
 * correctly revoke the whole session.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;

  refreshInFlight ??= (async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      const payload = (await response.json()) as ApiResponse<AuthTokens>;

      if (!response.ok || !payload.ok) {
        await clearTokens();
        onUnauthenticated?.();
        return false;
      }

      await setTokens(payload.data);
      return true;
    } catch {
      // A network failure is not an invalid session: keep the tokens so the
      // next attempt can succeed once connectivity returns.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/* ------------------------------------------------------------------ requests */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set for endpoints that are meaningful signed out. */
  auth?: boolean;
  signal?: AbortSignal;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }

  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

async function performRequest(
  path: string,
  options: RequestOptions,
  isRetry: boolean,
): Promise<{ response: Response; payload: ApiResponse<unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  options.signal?.addEventListener('abort', () => controller.abort());

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken && options.auth !== false) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = (text ? JSON.parse(text) : { ok: response.ok, data: null }) as ApiResponse<unknown>;

    // One transparent refresh-and-replay, then give up.
    if (
      response.status === 401 &&
      !isRetry &&
      !payload.ok &&
      payload.error.code === 'TOKEN_EXPIRED' &&
      (await refreshAccessToken())
    ) {
      return performRequest(path, options, true);
    }

    return { response, payload };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new NetworkError('The server sent an unexpected response.');
    }
    if ((error as Error).name === 'AbortError') {
      throw new NetworkError('That took too long. Check your connection and try again.');
    }
    throw new NetworkError();
  } finally {
    clearTimeout(timeout);
  }
}

/** Perform a request and return the unwrapped `data`. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { response, payload } = await performRequest(path, options, false);

  if (!payload.ok) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.fields,
      payload.error.details,
    );
  }

  return payload.data as T;
}

/** Perform a request that returns a list plus pagination metadata. */
export async function requestPaged<T>(
  path: string,
  options: RequestOptions = {},
): Promise<PagedResult<T>> {
  const { response, payload } = await performRequest(path, options, false);

  if (!payload.ok) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.fields,
      payload.error.details,
    );
  }

  const meta = (payload as { meta?: PaginationMeta }).meta;

  return {
    items: (payload.data as T[]) ?? [],
    nextCursor: meta?.nextCursor ?? null,
    hasMore: meta?.hasMore ?? false,
    ...(meta?.total !== undefined ? { total: meta.total } : {}),
  };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  paged: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestPaged<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};
