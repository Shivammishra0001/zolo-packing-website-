// Single-flight refresh for the STOREFRONT session (zolo.store.*).
//
// WHY THIS EXISTS: on a page load with an expired access token, several modules
// used to refresh independently and concurrently (the API client, the session
// restore in auth/service.ts). Refresh tokens ROTATE server-side and reuse of
// the old token is treated as theft — it revokes the whole session family. Two
// parallel refreshes therefore logged a perfectly valid user out, which
// surfaced as endless 401s on /admin/* while the UI still looked signed in.
//
// Every refresh now funnels through refreshStoreSession(): concurrent callers
// share ONE network request and one rotation.
import { API_BASE } from "../api-config";

const TOKEN_KEY = "zolo.store.accessToken";
const REFRESH_KEY = "zolo.store.refreshToken";

/** Fired on this tab when the session is truly over (refresh rejected). */
export const SESSION_EXPIRED_EVENT = "zolo:session-expired";

export function notifySessionExpired(): void {
  try {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  } catch {
    /* non-browser context */
  }
}

let inflight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    if (!body?.data?.accessToken) return false;
    localStorage.setItem(TOKEN_KEY, body.data.accessToken);
    // The server rotates the refresh token — persist the replacement, or the
    // next refresh replays a revoked token and kills the session family.
    if (body.data.refreshToken) localStorage.setItem(REFRESH_KEY, body.data.refreshToken);
    return true;
  } catch {
    // Network failure: NOT proof the session is dead. Report failure but let
    // the caller decide; tokens stay for a later retry.
    return false;
  }
}

/**
 * Refresh the storefront access token, sharing one request across concurrent
 * callers. Resolves true when a new access token is stored.
 */
export function refreshStoreSession(): Promise<boolean> {
  if (!inflight) {
    inflight = doRefresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
