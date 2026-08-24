// Centralised environment configuration. Fails fast on missing critical secrets
// in production; provides safe dev defaults locally.
const isProd = process.env.NODE_ENV === "production";

function required(name, devDefault) {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (!isProd && devDefault !== undefined) {
    // Never apply an insecure fallback silently — an unnoticed dev secret in a
    // shared or staging environment means every JWT is forgeable.
    console.warn(
      `[env] ${name} is not set — using an INSECURE development default. ` +
      `Set ${name} in server/.env before exposing this server to anyone else.`,
    );
    return devDefault;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

/**
 * Reject secrets that are present but obviously unsafe. A short or placeholder
 * JWT secret is brute-forceable, which makes every access token forgeable —
 * in production that must stop the boot, not merely warn.
 */
function assertStrongSecret(name, value) {
  const weak = ["change-me", "changeme", "secret", "dev-insecure-jwt-secret", "change-me-to-a-long-random-string"];
  const looksWeak = value.length < 32 || weak.some((w) => value.toLowerCase().includes(w));
  if (!looksWeak) return;
  const msg = `${name} is weak or a placeholder (needs >= 32 random chars).`;
  if (isProd) throw new Error(`${msg} Refusing to start in production.`);
  console.warn(`[env] ${msg} Generate one: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`);
}

export const env = {
  isProd,
  port: Number(process.env.PORT) || 5001,
  jwtSecret: required("JWT_SECRET", "dev-insecure-jwt-secret"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || "15m",
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS) || 30,
  // 32-byte key for AES-256-GCM field encryption (bank account numbers).
  bankEncKey: required("BANK_ENC_KEY", "dev-only-32-byte-key-change-me!!"),
  uploadsBaseUrl: process.env.UPLOADS_BASE_URL || `http://localhost:${Number(process.env.PORT) || 5001}/uploads`,

  /**
   * Browser origins allowed to call this API.
   *
   * Defaults cover the actual Vite dev server (5173 — see vite.config.ts) plus
   * the preview/nginx ports this project builds for. Extra origins come from
   * CORS_ORIGINS as a comma-separated list, so production is configured by
   * environment rather than by editing code.
   */
  corsOrigins: [
    ...new Set(
      [
        // Local dev conveniences — DEVELOPMENT ONLY. Baking these into a
        // production allow-list would let a page served from any developer's
        // machine call the live API with a real user's token.
        ...(process.env.NODE_ENV === "production"
          ? []
          : [
              "http://localhost:5173", "http://127.0.0.1:5173", // vite dev
              "http://localhost:4173", "http://127.0.0.1:4173", // vite preview
              "http://localhost:8080", "http://127.0.0.1:8080", // nginx (Dockerfile.web)
            ]),
        ...String(process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
      ],
    ),
  ],
};

// Validate secret strength once, at module load, so a bad configuration is
// caught at startup rather than at the first login attempt.
assertStrongSecret("JWT_SECRET", env.jwtSecret);

/**
 * Is this browser Origin allowed to call the API?
 *
 * Exact allow-list first. Then, in DEVELOPMENT ONLY, any loopback origin is
 * accepted: Vite auto-increments its port when 5173 is taken (5174, 5175, …),
 * and a hardcoded list would block the app with a CORS error the moment a
 * second dev server is running — the exact failure this is meant to prevent.
 * Production stays strictly on the configured list.
 */
export function isAllowedOrigin(origin) {
  if (env.corsOrigins.includes(origin)) return true;
  if (env.isProd) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  } catch {
    return false; // unparseable Origin header
  }
}
