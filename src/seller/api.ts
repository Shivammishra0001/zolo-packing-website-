// Seller/admin API client for the real Express+Prisma+Postgres backend (:5001).
// Identity is a real JWT stored in localStorage and sent as a Bearer token.
// This is the single HTTP entry point for the seller onboarding + admin-review
// features; it keeps its own token store (zolo.seller.*), separate from the
// storefront session (zolo.store.*), though both authenticate against the same
// real Prisma/Postgres backend.

export { API_BASE } from "@/lib/api-config";
import { API_BASE } from "@/lib/api-config";

const TOKEN_KEY = "zolo.seller.accessToken";
const REFRESH_KEY = "zolo.seller.refreshToken";
const USER_KEY = "zolo.seller.user";

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName?: string | null;
  role: string;
  phone?: string | null;
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  getUser: (): SessionUser | null => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  },
  set: (accessToken: string, refreshToken: string | undefined, user: SessionUser) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  setAccess: (accessToken: string) => localStorage.setItem(TOKEN_KEY, accessToken),
  setRefresh: (refreshToken: string) => localStorage.setItem(REFRESH_KEY, refreshToken),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  code?: string;
  issues?: { path: string; message: string }[];
  constructor(status: number, message: string, code?: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean; // attach bearer token (default true)
  _retried?: boolean;
}

async function attemptRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const body = await res.json();
  if (body?.data?.accessToken) {
    tokenStore.setAccess(body.data.accessToken);
    // Refresh tokens ROTATE server-side — persist the replacement.
    if (body.data.refreshToken) tokenStore.setRefresh(body.data.refreshToken);
    return true;
  }
  return false;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // On a 401 with a live refresh token, transparently refresh once and retry.
  if (res.status === 401 && auth && !opts._retried) {
    if (await attemptRefresh()) return request<T>(path, { ...opts, _retried: true });
    tokenStore.clear();
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
 * Fetch a binary response (e.g. a KYC document) as a Blob.
 *
 * Documents are streamed by an authorized route rather than exposed as a
 * static URL, so the Authorization header must travel with the request — which
 * means `window.open(url)` cannot work and we build an object URL instead.
 */
export async function requestBlob(path: string): Promise<Blob> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`, payload?.code);
  }
  return res.blob();
}

// ---- Auth ----
export const authApi = {
  register: (input: { email: string; password: string; firstName: string; lastName?: string; phone?: string; accountType: "buyer" | "seller"; companyName?: string }) =>
    request<{ user: SessionUser; accessToken: string; refreshToken: string; organizationId: string | null }>("/auth/register", { method: "POST", body: input, auth: false }),
  login: (input: { email: string; password: string }) =>
    request<{ user: SessionUser; accessToken: string; refreshToken: string }>("/auth/login", { method: "POST", body: input, auth: false }),
  me: () => request<{ user: SessionUser; organizationId: string | null; supplier: { id: string; status: string; verificationStatus: string; onboardingStep: number } | null }>("/auth/me"),
  logout: (refreshToken: string | null) => request<{ loggedOut: boolean }>("/auth/logout", { method: "POST", body: { refreshToken }, auth: false }),
};
