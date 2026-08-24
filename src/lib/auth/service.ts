import type { AuthUser, LoginCredentials, RegisterData } from "./types";

// ============================================================
// Storefront authentication service — REAL backend integration.
//
// Talks to the Express + Prisma + PostgreSQL API on :5001. Passwords are sent
// once over the wire in the request body and hashed server-side with bcrypt
// (see server/src/lib/crypto.mjs). Nothing here ever stores or transforms the
// password. The session is a JWT access token + an opaque refresh token; we
// keep them in localStorage under storefront-specific keys so a buyer session
// never collides with the seller-portal session.
//
// This module is the ONLY integration point between the storefront UI and the
// auth backend. AuthContext calls these functions and holds only the returned
// (non-sensitive) user object.
// ============================================================

import { API_BASE } from "../api-config";

// Storefront-scoped token keys (distinct from the seller portal's keys).
import { LEGACY_AUTH_KEYS, clearAllAuthStorage } from "./session-keys";

const TOKEN_KEY = "zolo.store.accessToken";
const REFRESH_KEY = "zolo.store.refreshToken";
const USER_KEY = "zolo.store.user";

/**
 * Auth keys written by earlier versions of the app. The legacy AuthCtx in
 * App.tsx used to trust these ("user" + "token") for a synchronous auto-login,
 * so any stale copy is a live hazard until removed.
 *
 * ONLY authentication keys are listed — cart, theme and preference keys are
 * deliberately left alone.
 */
// Key list lives in session-keys.ts so every portal clears the same set.

/** Broadcast channel so a logout in one tab signs out every other tab. */
const AUTH_CHANNEL = "zolo.auth";

/** Remove obsolete auth keys. Safe to call on every load; idempotent. */
export function purgeLegacyAuthKeys(): void {
  for (const store of [localStorage, sessionStorage]) {
    for (const k of LEGACY_AUTH_KEYS) {
      try {
        store.removeItem(k);
      } catch {
        /* storage unavailable (private mode) — nothing to purge */
      }
    }
  }
}

/** Notify other tabs that the session ended. */
function broadcastLogout(): void {
  try {
    new BroadcastChannel(AUTH_CHANNEL).postMessage({ type: "logout" });
  } catch {
    /* BroadcastChannel unsupported — the `storage` event below still fires */
  }
}

/**
 * Subscribe to sign-outs from other tabs. Fires when this tab should drop its
 * session, via BroadcastChannel or the cross-tab `storage` event.
 */
export function onAuthLogout(handler: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.onmessage = (e) => { if (e.data?.type === "logout") handler(); };
  } catch { /* unsupported */ }

  // Fallback + belt-and-braces: another tab clearing the token key.
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY && e.newValue === null) handler();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

interface BackendUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  phone?: string | null;
}

const tokenStore = {
  getAccess: () => localStorage.getItem(TOKEN_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  getUser: (): AuthUser | null => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  },
  set: (accessToken: string, refreshToken: string | undefined, user: AuthUser) => {
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

/** Raised when the credentials are rejected by the server (generic message). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

/** Raised when the API can't be reached at all (server down / network). */
export class AuthUnavailableError extends Error {
  constructor() {
    super("Could not connect to the server. Please try again in a moment.");
    this.name = "AuthUnavailableError";
  }
}

// Map the backend user shape onto the frontend AuthUser. The backend role set
// is richer (seller_owner, admin, …); the storefront only distinguishes
// "admin" from everyone-else ("buyer").
function toAuthUser(u: BackendUser): AuthUser {
  const role = u.role === "admin" ? "admin" : "buyer";
  return {
    id: u.id,
    email: u.email,
    phone: u.phone ?? "",
    role,
    firstName: u.firstName ?? undefined,
    lastName: u.lastName ?? undefined,
  };
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// Low-level POST that never attaches a token (used by login/register/refresh).
async function post<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch itself failed → server unreachable / CORS / offline.
    throw new AuthUnavailableError();
  }
  const payload = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { ...payload, success: res.ok && payload.success !== false };
}

// Authenticated GET with the current access token (used by /auth/me). Returns
// {status, data} so the caller can distinguish 401 (expired) from other errors.
async function authedGet<T>(path: string): Promise<{ status: number; data?: T }> {
  const token = tokenStore.getAccess();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const payload = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: res.status, data: res.ok ? payload.data : undefined };
}

type SessionResponse = {
  user: BackendUser;
  accessToken: string;
  refreshToken?: string;
};

export async function login(credentials: LoginCredentials): Promise<AuthUser> {
  // `identifier` may be an email or a phone number; the backend resolves either.
  const res = await post<SessionResponse>("/auth/login", {
    identifier: credentials.identifier.trim(),
    password: credentials.password,
  });
  if (!res.success || !res.data) {
    // 401 → bad credentials; anything else surfaced generically.
    if (res.code === "UNAUTHENTICATED" || res.error) throw new InvalidCredentialsError();
    throw new AuthUnavailableError();
  }
  const user = toAuthUser(res.data.user);
  tokenStore.set(res.data.accessToken, res.data.refreshToken, user);
  return user;
}

export async function register(data: RegisterData): Promise<AuthUser> {
  const [firstName, ...rest] = data.fullName.trim().split(/\s+/);
  const res = await post<SessionResponse>("/auth/register", {
    email: data.email.trim(),
    password: data.password,
    firstName: firstName || data.email.split("@")[0],
    lastName: rest.join(" ") || undefined,
    phone: data.phone || undefined,
    accountType: "buyer",
  });
  if (!res.success || !res.data) {
    if (res.code === "EMAIL_TAKEN") {
      throw new Error("An account with this email already exists. Try signing in.");
    }
    if (res.code === "PHONE_TAKEN") {
      throw new Error("An account with this phone number already exists. Try signing in.");
    }
    if (res.error) throw new Error(res.error);
    throw new AuthUnavailableError();
  }
  const user = toAuthUser(res.data.user);
  tokenStore.set(res.data.accessToken, res.data.refreshToken, user);
  return user;
}

export async function logout(): Promise<void> {
  // Revoke EVERY refresh token this browser holds, not just the storefront's.
  // The seller/admin console uses a separate store, and leaving its token
  // behind is what let a "logged out" user come back signed in with no
  // password on the next page load.
  const refreshTokens = [
    localStorage.getItem("zolo.store.refreshToken"),
    localStorage.getItem("zolo.seller.refreshToken"),
  ].filter((t): t is string => Boolean(t));

  // Best-effort server-side revocation; the local clear below is what actually
  // signs the user out, so a network failure must not skip it.
  await Promise.allSettled(refreshTokens.map((refreshToken) => post("/auth/logout", { refreshToken })));

  clearAllAuthStorage();
  broadcastLogout();
}

/**
 * Restore the session on page load, following the canonical flow:
 *   1. GET /auth/me with the stored access token.
 *   2. On 401 (access token expired) → POST /auth/refresh, then retry /me.
 *   3. Refresh rejected (expired/revoked) → clear the stale session (guest).
 * Returns the restored user, or null for guests.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  // Presence of stored tokens is only a HINT that a session may exist; the
  // backend decides. The cached user object is never used as the answer.
  const refreshToken = tokenStore.getRefresh();
  if (!tokenStore.getAccess() && !refreshToken) return null;
  if (!refreshToken) return null;

  try {
    // 1. Access token still valid?
    let me = await authedGet<{ user: BackendUser }>("/auth/me");

    // 2. Expired → refresh the access token and retry once.
    if (me.status === 401) {
      const refreshed = await post<{ accessToken: string; refreshToken?: string; user: BackendUser }>(
        "/auth/refresh",
        { refreshToken },
      );
      if (!refreshed.success || !refreshed.data) {
        tokenStore.clear(); // 3. refresh token dead → become a guest
        return null;
      }
      tokenStore.setAccess(refreshed.data.accessToken);
      // The server ROTATES the refresh token — persist the new one, or the
      // next refresh presents an already-revoked token and (correctly) fails.
      if (refreshed.data.refreshToken) tokenStore.setRefresh(refreshed.data.refreshToken);
      me = await authedGet<{ user: BackendUser }>("/auth/me");
    }

    if (me.status === 200 && me.data?.user) {
      const user = toAuthUser(me.data.user);
      tokenStore.set(tokenStore.getAccess() ?? "", tokenStore.getRefresh() ?? undefined, user);
      return user;
    }
    // Any other non-OK, non-401 status → don't trust the session.
    tokenStore.clear();
    return null;
  } catch {
    // SECURITY: the server could not be reached, so the session is UNVERIFIED.
    //
    // This used to return the cached localStorage user, which meant a stale
    // entry (or one an attacker typed into DevTools) logged someone straight
    // in — as admin — whenever the API was down. An unverified session is not
    // a session. Tokens are left in place so a later reload can legitimately
    // re-verify once the backend is reachable; the user is simply a guest now.
    return null;
  }
}
