// Storefront authenticated API client. Mirrors the seller client's request()
// (Bearer token + transparent refresh-on-401) but reads the STOREFRONT token
// (zolo.store.accessToken), so buyer commerce calls carry the buyer's identity.
//
// The storefront session tokens are owned by src/lib/auth/service.ts; this
// module only reads them from localStorage under the same keys.

export { API_BASE } from "../api-config";
import { API_BASE, describeNetworkError } from "../api-config";
import { clearAllAuthStorage } from "../auth/session-keys";
import { refreshStoreSession, notifySessionExpired } from "../auth/refresh";

const TOKEN_KEY = "zolo.store.accessToken";

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

// Refresh goes through the SHARED single-flight module: concurrent 401s from
// different stores (cart, auth restore, admin polling) share one rotation.
// Racing two refreshes trips the server's token-reuse detection and revokes
// the whole session — which is how valid admins were getting logged out.
const attemptRefresh = refreshStoreSession;

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
    // Tell React the session is over. Clearing storage alone left the UI
    // rendering as signed-in against empty storage until a manual reload.
    notifySessionExpired();
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

/**
 * Fetch a binary response (a requirement sheet, an invoice PDF) as a Blob.
 * These files are streamed by AUTHORIZED routes, never static URLs, so the
 * bearer token must travel with the request — window.open(url) cannot work.
 */
export async function requestBlob(path: string, opts: { _retried?: boolean } = {}): Promise<Blob> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new NetworkError(`GET ${path}`);
  }
  if (res.status === 401 && !opts._retried && (await attemptRefresh())) {
    return requestBlob(path, { _retried: true });
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`, payload?.code);
  }
  return res.blob();
}

/**
 * Classify an API failure for display. Keeps pages honest: a 401 must read as
 * "sign in again", never as "not found" — converting every error into a
 * not-found screen is how a broken session masqueraded as missing data.
 */
export function describeApiError(e: unknown): { kind: "unauthorized" | "forbidden" | "notFound" | "network" | "server"; message: string } {
  if (e instanceof NetworkError) return { kind: "network", message: "Unable to connect. Check your connection and try again." };
  if (e instanceof ApiError) {
    if (e.status === 401) return { kind: "unauthorized", message: "Your session has expired. Please sign in again." };
    if (e.status === 403) return { kind: "forbidden", message: "You do not have permission to view this." };
    if (e.status === 404) return { kind: "notFound", message: "This record does not exist." };
    return { kind: "server", message: e.message || "Something went wrong on the server." };
  }
  return { kind: "server", message: e instanceof Error ? e.message : "Something went wrong." };
}

/** Open a fetched file in the browser (view/download) via an object URL. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
