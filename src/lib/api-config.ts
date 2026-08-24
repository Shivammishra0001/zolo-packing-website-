// ============================================================
// Single source of truth for the API base URL.
//
// Every API module imports from here — previously four files each hardcoded
// "http://localhost:5001/api/v1", so a port or host change had to be made in
// four places and any missed one silently pointed at a dead address.
//
// Configure per-environment with VITE_API_BASE_URL (see .env.example). The
// dev default matches the port server/index.mjs binds.
// ============================================================

const DEV_DEFAULT = "http://localhost:5001/api/v1";

function resolveApiBase(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  // Production build with no explicit config: assume the API is served from the
  // same origin behind a reverse proxy, rather than pointing at localhost —
  // which would resolve to the *visitor's* machine.
  if (import.meta.env?.PROD) return "/api/v1";

  return DEV_DEFAULT;
}

export const API_BASE = resolveApiBase();

/** Absolute URL for an API path ("/products" → ".../api/v1/products"). */
export const apiUrl = (path: string): string =>
  `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Turn a failed fetch into a message that says what actually happened.
 *
 * A dead backend makes fetch() throw a bare TypeError whose message is
 * "Load failed" in Safari/WebKit and "fetch failed" in Node — neither tells
 * the user anything. Anywhere that string reaches the UI, this is why.
 */
export function describeNetworkError(error: unknown, operation: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const isTransport =
    error instanceof TypeError ||
    /load failed|fetch failed|networkerror|failed to fetch/i.test(raw);

  if (isTransport) {
    return (
      `${operation} failed: cannot reach the Zolo API at ${API_BASE}. ` +
      `Start the backend with \`cd server && npm run dev\`, then retry.`
    );
  }
  return `${operation} failed: ${raw}`;
}
