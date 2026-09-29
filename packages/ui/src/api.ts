import {
  API_ERROR_MESSAGES,
  type ApiErrorCode,
  type ApiResponse,
  type AuthTokens,
  type PaginationMeta,
} from '@grabgo/types';

/**
 * Browser API client, shared by both dashboards.
 *
 * Same contract as the mobile client: unwrap the envelope, raise a typed
 * `ApiError`, and refresh an expired access token once before giving up. Tokens
 * live in `sessionStorage` rather than `localStorage` — a dashboard on a shared
 * cafe machine should not stay signed in after the tab closes.
 */

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: Record<string, string[]> | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  get displayMessage(): string {
    return API_ERROR_MESSAGES[this.code] ?? this.message;
  }
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  storagePrefix: string;
  onUnauthenticated?: () => void;
}

export interface ApiClient {
  get<T>(path: string, query?: QueryParams): Promise<T>;
  paged<T>(path: string, query?: QueryParams): Promise<PagedResult<T>>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
  setTokens(tokens: AuthTokens): void;
  clearTokens(): void;
  hasSession(): boolean;
  accessToken(): string | null;
}

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const accessKey = `${options.storagePrefix}.access`;
  const refreshKey = `${options.storagePrefix}.refresh`;

  const read = (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const write = (key: string, value: string | null): void => {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch {
      // Private browsing or storage disabled; the session simply lasts as long
      // as the page does.
    }
  };

  let refreshInFlight: Promise<boolean> | null = null;

  const refresh = async (): Promise<boolean> => {
    const refreshToken = read(refreshKey);
    if (!refreshToken) return false;

    // Single-flight: several parallel 401s must not each rotate the token, or
    // the server's replay detection revokes the whole session.
    refreshInFlight ??= (async () => {
      try {
        const response = await fetch(`${options.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        const payload = (await response.json()) as ApiResponse<AuthTokens>;

        if (!response.ok || !payload.ok) {
          write(accessKey, null);
          write(refreshKey, null);
          options.onUnauthenticated?.();
          return false;
        }

        write(accessKey, payload.data.accessToken);
        write(refreshKey, payload.data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  const buildUrl = (path: string, query?: QueryParams): string => {
    const url = `${options.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.append(key, String(value));
    }

    const search = params.toString();
    return search ? `${url}?${search}` : url;
  };

  const send = async (
    path: string,
    init: { method: string; body?: unknown; query?: QueryParams },
    isRetry = false,
  ): Promise<{ status: number; payload: ApiResponse<unknown> }> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const token = read(accessKey);
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;

    try {
      response = await fetch(buildUrl(path, init.query), {
        method: init.method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new ApiError(
        'SERVICE_UNAVAILABLE',
        'Something went wrong. Check your connection and try again.',
        0,
      );
    }

    const text = await response.text();
    const payload = (text ? JSON.parse(text) : { ok: response.ok, data: null }) as ApiResponse<unknown>;

    if (
      response.status === 401 &&
      !isRetry &&
      !payload.ok &&
      payload.error.code === 'TOKEN_EXPIRED' &&
      (await refresh())
    ) {
      return send(path, init, true);
    }

    if (response.status === 401 && !payload.ok) {
      options.onUnauthenticated?.();
    }

    return { status: response.status, payload };
  };

  const unwrap = <T>(status: number, payload: ApiResponse<unknown>): T => {
    if (!payload.ok) {
      throw new ApiError(
        payload.error.code,
        payload.error.message,
        status,
        payload.error.fields,
      );
    }
    return payload.data as T;
  };

  return {
    async get<T>(path: string, query?: QueryParams) {
      const { status, payload } = await send(path, { method: 'GET', ...(query ? { query } : {}) });
      return unwrap<T>(status, payload);
    },

    async paged<T>(path: string, query?: QueryParams) {
      const { status, payload } = await send(path, { method: 'GET', ...(query ? { query } : {}) });
      const items = unwrap<T[]>(status, payload);
      const meta = (payload as { meta?: PaginationMeta }).meta;

      return {
        items,
        nextCursor: meta?.nextCursor ?? null,
        hasMore: meta?.hasMore ?? false,
        ...(meta?.total !== undefined ? { total: meta.total } : {}),
      };
    },

    async post<T>(path: string, body?: unknown) {
      const { status, payload } = await send(path, { method: 'POST', body });
      return unwrap<T>(status, payload);
    },

    async patch<T>(path: string, body?: unknown) {
      const { status, payload } = await send(path, { method: 'PATCH', body });
      return unwrap<T>(status, payload);
    },

    async put<T>(path: string, body?: unknown) {
      const { status, payload } = await send(path, { method: 'PUT', body });
      return unwrap<T>(status, payload);
    },

    async delete<T>(path: string, body?: unknown) {
      const { status, payload } = await send(path, { method: 'DELETE', body });
      return unwrap<T>(status, payload);
    },

    setTokens(tokens: AuthTokens) {
      write(accessKey, tokens.accessToken);
      write(refreshKey, tokens.refreshToken);
    },

    clearTokens() {
      write(accessKey, null);
      write(refreshKey, null);
    },

    hasSession() {
      return read(refreshKey) !== null;
    },

    accessToken() {
      return read(accessKey);
    },
  };
}
