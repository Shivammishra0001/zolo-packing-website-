// Apply pending Prisma migrations to the CONFIGURED database.
//
// Why this exists: `npm run build` never ran migrations, so a freshly created
// production database stayed empty. Every data route then failed with
//   P2021  The table `public.User` does not exist in the current database
// while /api/v1/public/health still returned 200 (it never touches the DB).
//
// This wraps `prisma migrate deploy`, which is the production-safe command:
// it applies existing migration files in order and NEVER resets, drops or
// rewrites data. It is idempotent — a second run is a no-op.
//
// Guards below make the destructive foot-guns unreachable:
//   1. refuses to run without DATABASE_URL
//   2. refuses to run against localhost unless ALLOW_LOCAL_MIGRATE=1, so a
//      stray shell cannot migrate the dev database while you believe you are
//      fixing production
//   3. only ever spawns `migrate deploy` — reset/push are not reachable here
//   4. prints host/database/sslmode but NEVER the password
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg, hint) {
  console.error(`\n✖ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  die(
    "DATABASE_URL is not set.",
    "Export the PRODUCTION connection string first, e.g.\n" +
      "    export DATABASE_URL='postgresql://USER:PASS@HOST:25060/DB?sslmode=require'",
  );
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  die(
    "DATABASE_URL is not a valid URL.",
    "Expected postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require\n" +
      "  Percent-encode any @ : / ? # % inside the password.",
  );
}

const host = parsed.hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
if (isLocal && process.env.ALLOW_LOCAL_MIGRATE !== "1") {
  die(
    `Refusing to migrate a local database (${host}).`,
    "This script is for production. To migrate a local database on purpose:\n" +
      "    ALLOW_LOCAL_MIGRATE=1 npm run migrate:prod",
  );
}

// Never print credentials — only the parts needed to confirm the target.
console.log("\n  Applying migrations");
console.log(`  Host:     ${host}`);
console.log(`  Database: ${parsed.pathname.slice(1) || "(default)"}`);
console.log(`  SSL mode: ${parsed.searchParams.get("sslmode") ?? "(not set)"}`);
if (!isLocal && parsed.searchParams.get("sslmode") !== "require") {
  console.warn("  ! sslmode=require is expected for DigitalOcean managed Postgres.");
}
console.log("");

// `migrate deploy` is the only command this script can run. Prisma resolves
// DATABASE_URL from the environment; server/.env is absent in production, and
// where it exists it would OVERRIDE the exported value — so it is neutralised
// here to guarantee the target is the URL the operator actually exported.
const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", "--schema", resolve(serverDir, "prisma/schema.prisma")],
  {
    cwd: serverDir,
    stdio: "inherit",
    env: { ...process.env, DOTENV_CONFIG_PATH: "/dev/null", PRISMA_SKIP_DOTENV: "1" },
  },
);

if (result.status !== 0) {
  die(
    "Migration failed — the database was NOT reset and no data was removed.",
    "Read the Prisma error above. Do not run `prisma migrate reset` against production.",
  );
}

console.log("\n  ✓ Migrations applied. Verify with: npm run migrate:status\n");
