// Storefront authenticated API client. Mirrors the seller client's request()
// (Bearer token + transparent refresh-on-401) but reads the STOREFRONT token
// (zolo.store.accessToken), so buyer commerce calls carry the buyer's identity.
//
// The storefront session tokens are owned by src/lib/auth/service.ts; this
// module only reads them from localStorage under the same keys.

export { API_BASE } from "../api-config";
import { API_BASE, describeNetworkError } from "../api-config";
import { clearAllAuthStorage } from "../auth/session-keys";

const TOKEN_KEY = "zolo.store.accessToken";
const REFRESH_KEY = "zolo.store.refreshToken";

export class ApiError extends Error {
  status: number;
  code?: string;
  issues?: { path: string; message: string }[];
  constructor(status: number, message: string, code?: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Raised when the API can't be reached at all (server down / offline). */
export class NetworkError extends Error {
  constructor(operation = "Request") {
    // Name the address and the fix. The browser's own message for an
    // unreachable host is "Load failed" (Safari) / "Failed to fetch" (Chrome),
    // which tells the user nothing about what to do.
    super(describeNetworkError(new TypeError("fetch failed"), operation));
    this.name = "NetworkError";
  }
}

const getToken = () => localStorage.getItem(TOKEN_KEY);
const getRefresh = () => localStorage.getItem(REFRESH_KEY);
const setAccess = (t: string) => localStorage.setItem(TOKEN_KEY, t);
const setRefresh = (t: string) => localStorage.setItem(REFRESH_KEY, t);

async function attemptRefresh(): Promise<boolean> {
  const refreshToken = getRefresh();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    if (body?.data?.accessToken) {
      setAccess(body.data.accessToken);
      // Refresh tokens ROTATE server-side — store the replacement, otherwise
      // the next refresh replays a revoked token and the session dies.
      if (body.data.refreshToken) setRefresh(body.data.refreshToken);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach the bearer token (default true)
  _retried?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError(`${method} ${path}`);
  }

  // Transparent refresh + retry once on a 401.
  //
  // If the refresh also fails the session is genuinely over, so the dead tokens
  // are cleared. Leaving them behind made every later request retry a doomed
  // refresh and kept the UI in a half-authenticated state — a 401 that never
  // resolved into "you are signed out".
  if (res.status === 401 && auth && !opts._retried) {
    if (await attemptRefresh()) return request<T>(path, { ...opts, _retried: true });
    clearAllAuthStorage();
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    throw new ApiError(
      res.status,
      payload?.error ?? `Request failed (${res.status})`,
      payload?.code,
      payload?.issues,
    );
  }
  return payload.data as T;
}
