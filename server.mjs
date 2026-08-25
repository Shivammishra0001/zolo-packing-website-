// Production entrypoint — ONE process serving both halves of the app.
//
// DigitalOcean App Platform runs a single web process per service, and the
// frontend calls same-origin "/api/v1" in production builds (see
// src/lib/api-config.ts). So this process mounts the real Express API and
// serves the built SPA in front of it:
//
//   /api/v1/*   -> the Express app from server/src/app.mjs (unchanged)
//   /uploads/*  -> product images, served by that same app
//   everything else -> dist/ static assets, falling back to index.html
//
// The API is IMPORTED, not reimplemented: createApp() is the same factory
// server/index.mjs uses, so routes, auth, RBAC and validation are identical in
// both local development and production.
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import express from "express";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(__dirname, "dist");
const indexHtml = join(distDir, "index.html");

// PORT is assigned by the platform; 8080 is only a local fallback, and it
// deliberately matches `http_port` in .do/app.yaml. If PORT were ever unset the
// server would still bind the port the readiness probe dials — a mismatch here
// surfaces as "connection refused" on a container that started perfectly.
//
// Binding 0.0.0.0 is required: the probe reaches the container from outside,
// and a server bound to 127.0.0.1 is unreachable and marked failed.
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

function fail(message, detail) {
  console.error(`\n✖ ${message}`);
  if (detail) console.error(`  ${detail}`);
  console.error("");
  process.exit(1);
}

// Fail fast and legibly rather than serving 404s for every request.
if (!existsSync(indexHtml)) {
  fail(
    "dist/index.html is missing — the frontend was never built.",
    "Run `npm run build` before `npm start` (the platform build command should do this).",
  );
}

const app = express();

// Trust the platform's proxy so req.ip is the real client. Rate limiting is
// keyed on it, and App Platform always fronts the container with one hop.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));

// ---------------------------------------------------------------------------
// Database migrations
//
// Applied at STARTUP, not at build time. `.do/app.yaml` is only read when an
// app is created from that spec (or updated with `doctl apps update`) — a
// Build Command set in the App Platform UI overrides it, so a migration step
// living only in the spec can silently never run. That is how this database
// stayed empty while deploys kept succeeding, and every data route returned
//   P2021  The table `public.User` does not exist in the current database
// `npm start` always runs, so putting it here makes it unskippable.
//
// `prisma migrate deploy` is the production-safe command: it applies pending
// migrations in order and never resets, drops or rewrites data. It is
// idempotent, so a boot with nothing pending costs one quick no-op.
//
// Set SKIP_MIGRATIONS=1 to opt out (e.g. if you run migrations in a separate
// release step and want faster boots).
// ---------------------------------------------------------------------------
if (process.env.SKIP_MIGRATIONS !== "1" && process.env.DATABASE_URL) {
  const { spawnSync } = await import("node:child_process");
  console.log("\n  Applying database migrations…");
  const migrate = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", resolve(__dirname, "server/prisma/schema.prisma")],
    { cwd: resolve(__dirname, "server"), stdio: "inherit", env: process.env },
  );
  // A failed migration means the schema is not what the code expects. Starting
  // anyway would serve 500s from a half-migrated database; fail loudly instead.
  // Nothing is rolled back or reset — the database is left exactly as it was.
  if (migrate.status !== 0) {
    fail(
      "Database migration failed — the database was NOT reset and no data was removed.",
      "Read the Prisma error above. Common causes: DATABASE_URL unreachable (check the\n" +
        "  database's Trusted Sources), a wrong password, or a missing ?sslmode=require.",
    );
  }
}

// ---------------------------------------------------------------------------
// Admin user
//
// Runs only when ADMIN_EMAIL and ADMIN_PASSWORD are both set, and only AFTER
// migrations — a freshly migrated database has no users, so there would
// otherwise be no way to sign in to the admin portal.
//
// The seed is idempotent: it upserts on the unique email, so redeploys never
// create duplicates. It does reset that account's password to ADMIN_PASSWORD
// on every boot, which is why you should delete ADMIN_PASSWORD from the
// environment once you have signed in and changed it in the app — otherwise a
// redeploy silently reverts the password to the env value.
//
// The password is only ever stored as a bcrypt hash (scripts/seed-admin.mjs);
// it is never logged here or written to the database in plain text.
// ---------------------------------------------------------------------------
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.DATABASE_URL) {
  const { spawnSync } = await import("node:child_process");
  console.log("  Ensuring admin user…");
  const seed = spawnSync("node", ["scripts/seed-admin.mjs"], {
    cwd: resolve(__dirname, "server"),
    stdio: "inherit",
    env: process.env,
  });
  // A failed seed is not fatal: the API is still healthy and every other user
  // can sign in. Warn loudly rather than refusing to serve traffic.
  if (seed.status !== 0) {
    console.warn("  ! Admin seed failed — check ADMIN_EMAIL / ADMIN_PASSWORD. Continuing.");
  }
}

// ---------------------------------------------------------------------------
// API
//
// Mounted first so it can never be shadowed by the SPA fallback below. If the
// API cannot be constructed (missing DATABASE_URL, weak JWT_SECRET, …) that is
// a fatal misconfiguration: starting a "healthy" container that 404s every API
// call is worse than not starting at all.
// ---------------------------------------------------------------------------
let apiApp;
try {
  const { createApp } = await import("./server/src/app.mjs");
  apiApp = createApp();
} catch (err) {
  fail(
    "Could not initialise the API.",
    `${err.message.split("\n")[0]}\n  Check the server environment variables (DATABASE_URL, JWT_SECRET, BANK_ENC_KEY).`,
  );
}

// createApp() namespaces its own routes under /api/v1 and /uploads, but its
// CORS middleware is GLOBAL — mounted at the root it ran on every request,
// including the SPA's own JavaScript and CSS.
//
// In production `isAllowedOrigin` trusts only CORS_ORIGINS, which is empty in a
// single-service deployment (the SPA and API share one origin, so CORS is not
// needed at all). The browser sends `Origin: https://<app>` when fetching
// /assets/*, the gate rejected it, and every script and stylesheet returned
// 403 — a blank page served by a perfectly healthy container.
//
// Scoping the mount to the paths the API actually owns keeps the CORS policy
// exactly as strict for the API while leaving same-origin static files alone.
// Mounted with a path FILTER rather than a prefix: `app.use("/api", apiApp)`
// would strip "/api" before the inner router sees it, so its own /api/v1
// routes would 404. This forwards only API/upload requests while leaving the
// URL intact.
app.use((req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return apiApp(req, res, next);
  return next();
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

// Vite emits content-hashed filenames under /assets, so they can be cached
// indefinitely. Everything else gets a short cache.
app.use(
  "/assets",
  express.static(join(distDir, "assets"), {
    immutable: true,
    maxAge: "1y",
    fallthrough: true,
  }),
);

app.use(
  express.static(distDir, {
    index: false, // index.html is served explicitly below, with no-store
    maxAge: "1h",
    setHeaders(res, filePath) {
      if (extname(filePath) === ".html") res.setHeader("Cache-Control", "no-store, must-revalidate");
    },
  }),
);

// SPA fallback. React Router owns client-side routes, so any non-file path
// returns index.html — but never for /api or /uploads, which would turn a
// genuine API 404 into a 200 page and make debugging impossible.
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
  // index.html must not be cached, or browsers keep loading a stale bundle
  // after a deploy and call routes that may no longer exist.
  res.setHeader("Cache-Control", "no-store, must-revalidate");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  readFile(indexHtml).then(
    (html) => res.send(html),
    () => next(),
  );
});

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------
const server = app.listen(PORT, HOST);

server.on("listening", () => {
  const size = statSync(indexHtml).size;
  console.log("\n  Zolo Packing — production");
  console.log(`  Listening:   http://${HOST}:${PORT}`);
  console.log(`  API:         /api/v1`);
  console.log(`  Health:      /api/v1/public/health`);
  console.log(`  Frontend:    dist/ (index.html ${(size / 1024).toFixed(0)} KB)`);
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    fail(`Port ${PORT} is already in use.`, `Stop the other process: lsof -ti tcp:${PORT} | xargs kill`);
  }
  fail("Server failed to start.", err.message);
});

// Container orchestrators send SIGTERM before replacing an instance. Close
// cleanly so in-flight requests finish instead of being severed.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
