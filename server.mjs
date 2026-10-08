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
/**
 * The name of the migration Prisma reports as FAILED, or null.
 * Parsed from `migrate status`, which names it in plain text.
 */
async function findFailedMigration() {
  // Read _prisma_migrations DIRECTLY rather than parsing `migrate status`
  // output. That text is localised, ANSI-coloured and reworded between Prisma
  // releases, and a regex that misses simply skips the recovery silently —
  // which is exactly what happened on App Platform while it worked locally.
  //
  // Prisma's own definition of "failed": started, never finished, not rolled
  // back.
  try {
    const { PrismaClient } = await import("./server/node_modules/@prisma/client/index.js");
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations"
         WHERE finished_at IS NULL AND rolled_back_at IS NULL
         ORDER BY started_at ASC LIMIT 1`,
      );
      return rows?.[0]?.migration_name ?? null;
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    return null; // cannot read it — do not guess
  }
}

/**
 * Does the schema that migration would have created actually exist?
 *
 * Guards the auto-resolve: marking a migration applied when its tables are
 * missing would hide a real failure and leave the app serving 500s.
 */
async function schemaLooksApplied() {
  try {
    const { PrismaClient } = await import("./server/node_modules/@prisma/client/index.js");
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS n
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('User', 'Product', 'Order')`;
      return Number(rows?.[0]?.n ?? 0) === 3;
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    return false; // cannot prove it — do not auto-resolve
  }
}

if (process.env.SKIP_MIGRATIONS !== "1" && process.env.DATABASE_URL) {
  const { spawnSync } = await import("node:child_process");
  const serverDir = resolve(__dirname, "server");
  const schema = resolve(serverDir, "prisma/schema.prisma");
  const runPrisma = (args, opts = {}) =>
    spawnSync("npx", ["prisma", ...args, "--schema", schema], {
      cwd: serverDir,
      env: process.env,
      ...opts,
    });

  console.log("\n  Applying database migrations…");
  let migrate = runPrisma(["migrate", "deploy"], { stdio: "inherit" });

  // ---- P3009 recovery -----------------------------------------------------
  // A migration recorded as FAILED blocks every later one, and `migrate deploy`
  // can never clear it by itself. This happens when an earlier deploy applied
  // the schema but was interrupted before marking it done: the re-run then hits
  // "relation already exists" and is logged as a failure, even though the
  // tables are present and correct.
  //
  // Resolving it is pure BOOKKEEPING — `migrate resolve --applied` only writes
  // to the _prisma_migrations table and never touches application data. It is
  // still gated: we only do it when the migration's own tables genuinely exist,
  // so a migration that truly failed part-way is never waved through.
  if (migrate.status !== 0) {
    const failed = await findFailedMigration();
    if (failed) {
      console.log(`  Migration ${failed} is recorded as failed; checking whether its schema is actually present…`);
      if (await schemaLooksApplied()) {
        console.log(`  Tables exist — marking ${failed} as applied (no data is touched).`);
        const resolved = runPrisma(["migrate", "resolve", "--applied", failed], { stdio: "inherit" });
        if (resolved.status === 0) {
          console.log("  Retrying migrations…");
          migrate = runPrisma(["migrate", "deploy"], { stdio: "inherit" });
        }
      } else {
        console.error(`  ${failed} failed and its tables are NOT present — this needs a human, not an automatic retry.`);
      }
    }
  }
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
// Runs on every boot (after migrations) whenever a database is configured, so a
// fresh deploy ALWAYS has a working admin login with NO env vars required:
//   - ADMIN_EMAIL + ADMIN_PASSWORD set → that account, password reset to the
//     env value (env always wins).
//   - neither set → the built-in default admin is ensured (create-if-missing;
//     an existing admin's password is never reset). See scripts/seed-admin.mjs.
//
// The password is only ever stored as a bcrypt hash; the default's plaintext
// lives nowhere in the repo (only its hash), and nothing is logged in plain text.
// ---------------------------------------------------------------------------
if (process.env.DATABASE_URL) {
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
    console.warn("  ! Admin seed failed — continuing.");
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
// Ephemeral containers start every deploy from the built image, so ./uploads
// is empty and every product renders a broken image. Put the bundled
// catalogue images back BEFORE the API starts serving /uploads. No-ops once
// SPACES_* is configured, because images then live outside the container.
try {
  const { restoreSeedImages } = await import("./server/src/lib/restore-seed-images.mjs");
  console.log(`  Images:   ${restoreSeedImages()}`);
} catch (err) {
  console.warn(`  Images:   restore skipped (${err.message.split("\n")[0]})`);
}

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

// Attach the RFQ negotiation chat gateway (Socket.IO) to the SAME HTTP server.
// This is the production entrypoint, so the gateway must be initialised here —
// server/index.mjs (used in local dev) does the same. Non-fatal on failure so
// a chat problem can never take down the whole API.
try {
  const { initChatGateway } = await import("./server/src/realtime/chat-gateway.mjs");
  initChatGateway(server);
  console.log("  Realtime:    socket.io on /socket.io");
} catch (err) {
  console.warn("  ! Chat gateway init failed — continuing without realtime chat:", err.message.split("\n")[0]);
}

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
