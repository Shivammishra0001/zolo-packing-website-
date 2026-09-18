// `pretest`: make sure the isolated test database exists and is migrated.
// Never touches the development database. Idempotent and fast on re-runs.
import { execFileSync } from "node:child_process";
import { testDatabaseUrl } from "./setup-db.mjs";

const url = testDatabaseUrl();
const dbName = new URL(url).pathname.replace(/^\//, "");
console.log(`[test-db] using database "${dbName}" (migrating…)`);
// prisma migrate deploy creates the database when it does not exist and
// applies any pending migrations; a fully migrated database is a no-op.
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, DATABASE_URL: url },
});
console.log(`[test-db] "${dbName}" is up to date`);
