// Every browser storage key that can hold an authenticated session.
//
// WHY THIS EXISTS: the storefront and the seller/admin portal keep separate
// token stores (`zolo.store.*` and `zolo.seller.*`). Each logout used to clear
// only its own keys, so signing out of one portal left the other portal's
// refresh token in localStorage — and the app silently restored that session on
// the next page load. The user pressed "log out" and came back still signed in,
// without ever entering a password.
//
// Logout must therefore be portal-agnostic: signing out means ending EVERY
// session this browser holds, not just the one whose button was clicked. When a
// new portal is added, its keys belong in this list.

/** Storefront (buyer) session. */
export const STORE_AUTH_KEYS = [
  "zolo.store.accessToken",
  "zolo.store.refreshToken",
  "zolo.store.user",
] as const;

/** Seller + admin console session. */
export const SELLER_AUTH_KEYS = [
  "zolo.seller.accessToken",
  "zolo.seller.refreshToken",
  "zolo.seller.user",
] as const;

/**
 * Keys written by earlier versions. A stale copy is a live hazard because the
 * old AuthCtx trusted them for a synchronous auto-login.
 */
export const LEGACY_AUTH_KEYS = [
  "user",
  "token",
  "authToken",
  "accessToken",
  "refreshToken",
  "role",
] as const;

export const ALL_AUTH_KEYS: readonly string[] = [
  ...STORE_AUTH_KEYS,
  ...SELLER_AUTH_KEYS,
  ...LEGACY_AUTH_KEYS,
];

/**
 * Remove every auth key from both localStorage and sessionStorage.
 *
 * Deliberately clears ALL portals: a half-cleared browser is what produced the
 * "logged out but still signed in" bug. Non-auth keys (cart, theme,
 * preferences) are left untouched.
 */
export function clearAllAuthStorage(): void {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of ALL_AUTH_KEYS) {
      try {
        store.removeItem(key);
      } catch {
        // Storage can be unavailable (private mode, disabled cookies). Keep
        // going so one failure cannot leave later keys behind.
      }
    }
  }
}

/**
 * True if this browser still holds any auth key.
 *
 * Used after logout to assert the clear actually worked, rather than assuming.
 */
export function hasAnyAuthStorage(): boolean {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of ALL_AUTH_KEYS) {
      try {
        if (store.getItem(key) !== null) return true;
      } catch {
        /* unreadable storage holds nothing we can act on */
      }
    }
  }
  return false;
}
