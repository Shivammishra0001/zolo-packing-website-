import { API_BASE } from "./api-config";

// ============================================================
// Resolve a stored upload path to something the browser can fetch.
//
// The server stores image URLs as root-relative paths ("/uploads/xyz.jpg").
// In PRODUCTION that is correct: one process serves both the API and the SPA,
// so the path resolves against the same origin.
//
// In DEVELOPMENT the SPA is on Vite (:5173) and the API on :5001, so the same
// path resolves against Vite, which answers with the SPA's index.html — the
// <img> then renders as a broken image with no error anyone would notice.
//
// This derives the API's origin from the configured API base, so there is one
// place to change and no second environment variable to keep in step.
// ============================================================

/** The origin serving /uploads, or "" when it is this same origin. */
const UPLOAD_ORIGIN = (() => {
  try {
    const api = new URL(API_BASE, window.location.href);
    return api.origin === window.location.origin ? "" : api.origin;
  } catch {
    return "";
  }
})();

/**
 * Make a stored asset path renderable.
 *
 * Absolute URLs (http:, data:, blob:) are returned untouched — they already
 * say where they live. Only a root-relative path is rewritten.
 */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  if (!path.startsWith("/")) return path;
  return UPLOAD_ORIGIN + path;
}
