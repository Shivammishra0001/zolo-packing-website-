// Fixed-window rate limiting for authentication endpoints.
//
// Without this, /auth/login accepts unlimited password guesses. bcrypt makes
// each attempt costly but not costly enough to stop an overnight run against a
// weak password.
//
// SCOPE: state is in-process, so limits are per server instance. That is
// correct for the current single-process deployment; behind a load balancer or
// multiple replicas this must move to Redis (or a shared store) or an attacker
// simply spreads attempts across instances. Documented rather than pretended
// away.
import { createHash } from "node:crypto";
import { HttpError } from "../lib/http.mjs";

const buckets = new Map();

// Bound memory: a flood of unique keys must not grow the map without limit.
const MAX_KEYS = 10_000;

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @param windowMs  length of the fixed window
 * @param max       requests allowed per key per window
 * @param keyFn     derives the bucket key (default: client IP)
 */
export function rateLimit({ windowMs = 15 * 60_000, max = 10, keyFn = null, message = null } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    // Periodically drop expired buckets rather than on every request.
    if (buckets.size > MAX_KEYS) sweep(now);

    const key = keyFn ? keyFn(req) : req.ip || "unknown";
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return next(
        new HttpError(
          429,
          message ?? `Too many attempts. Try again in ${retryAfter} seconds.`,
          "RATE_LIMITED",
        ),
      );
    }

    next();
  };
}

/** Test hook: clear all buckets so one test's attempts don't limit the next. */
export function resetRateLimits() {
  buckets.clear();
}

/**
 * Login limiter, keyed on IP **and** the submitted identifier.
 *
 * IP alone lets one attacker behind a shared NAT lock out an office; identifier
 * alone lets an attacker lock a known victim out of their own account. Keying
 * on the pair throttles credential stuffing while leaving other users on the
 * same IP, and the same user from another IP, unaffected.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  keyFn: (req) => {
    const id = String(req.body?.identifier ?? req.body?.email ?? "").trim().toLowerCase();
    return `login:${req.ip || "unknown"}:${id}`;
  },
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});

/** Registration limiter — blunts automated account creation. */
export const registerRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  max: 20,
  keyFn: (req) => `register:${req.ip || "unknown"}`,
  message: "Too many accounts created from this address. Please try again later.",
});

/**
 * Refresh limiter.
 *
 * Keyed on the presented token, NOT the IP. Everyone behind one office NAT
 * shares an IP, so an IP-keyed limit would lock a whole building out of session
 * recovery — and session recovery is exactly what a user needs when their
 * access token has just expired.
 *
 * Per-token is still the right protection: a stolen or replayed token cannot be
 * ground against the endpoint, because each distinct token gets its own small
 * budget. A legitimate client refreshes once per access-token lifetime, and
 * rotation means the next refresh presents a different token entirely.
 */
export const refreshRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  keyFn: (req) => {
    const token = String(req.body?.refreshToken ?? "");
    // Hashing keeps the raw token out of the in-memory key map.
    const digest = createHash("sha256").update(token).digest("hex").slice(0, 32);
    return `refresh:${digest || req.ip || "unknown"}`;
  },
  message: "Too many refresh attempts for this session. Please sign in again.",
});
