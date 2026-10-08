// Empty every application table, keeping the schema exactly as it is.
//
// DESTRUCTIVE AND IRREVERSIBLE. Requires --yes, and prints the row counts it is
// about to delete so a mistake is visible before it happens.
//
// What it does NOT touch:
//   * table/column/index/constraint/enum definitions — nothing is dropped
//   * _prisma_migrations — migration history stays intact, so `migrate deploy`
//     does not try to replay 27 migrations against a schema that already exists
//   * the application source, the Prisma schema, or the migration files
//
// TRUNCATE ... CASCADE in ONE statement across all tables, so foreign keys
// never have to be ordered and nothing is left half-deleted: either every table
// is emptied or none is. RESTART IDENTITY resets sequences, so a fresh install
// starts numbering from the beginning.
//
// The admin user is deliberately recreated afterwards (unless --no-admin):
// deleting it with no replacement locks you out of the admin panel entirely,
// and the boot seed would recreate it on the next start anyway.
//
//   node scripts/reset-database.mjs              # dry run — counts only
//   node scripts/reset-database.mjs --yes        # perform the reset
//   node scripts/reset-database.mjs --yes --no-admin
import { PrismaClient, Prisma } from "@prisma/client";

const apply = process.argv.includes("--yes");
const keepAdmin = !process.argv.includes("--no-admin");
const prisma = new PrismaClient();

/** Physical table names, derived from the schema so a new model is never missed. */
const tables = Prisma.dmmf.datamodel.models.map((m) => m.dbName || m.name);

function die(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

try {
  const url = process.env.DATABASE_URL;
  if (!url) die("DATABASE_URL is not set.");

  // Say which database is about to be emptied — never print the password.
  const parsed = new URL(url);
  console.log("\n  Target");
  console.log(`    host:     ${parsed.hostname}`);
  console.log(`    database: ${parsed.pathname.slice(1)}`);

  // Count first: the operator sees exactly what is at stake.
  const counts = [];
  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      const n = Number(rows?.[0]?.n ?? 0);
      if (n > 0) counts.push([t, n]);
    } catch {
      // Table absent (a migration not yet applied) — nothing to delete.
    }
  }
  const total = counts.reduce((s, [, n]) => s + n, 0);

  console.log(`\n  ${total.toLocaleString()} row(s) across ${counts.length} table(s) would be deleted`);
  for (const [t, n] of counts.sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(7)}  ${t}`);
  }
  if (counts.length > 12) console.log(`    …and ${counts.length - 12} more`);

  if (!apply) {
    console.log("\n  Dry run — nothing was deleted. Re-run with --yes to perform the reset.\n");
    process.exit(0);
  }

  // One statement: FKs need no ordering and the whole thing is atomic.
  const list = tables.map((t) => `"public"."${t}"`).join(", ");
  console.log("\n  Truncating…");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log("  All application tables are empty.");

  if (keepAdmin) {
    // Recreating it here means the reset leaves a usable system rather than a
    // locked one. ensureAdmin() is the same code the server runs at boot.
    const { ensureAdmin } = await import("../src/lib/ensure-admin.mjs");
    console.log(`  ${await ensureAdmin()}`);
  } else {
    console.log("  Admin NOT recreated (--no-admin). The server will recreate one on next boot.");
  }

  // Prove the result rather than assert it.
  let remaining = 0;
  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      remaining += Number(rows?.[0]?.n ?? 0);
    } catch { /* absent table */ }
  }
  console.log(`\n  Rows remaining: ${remaining}${keepAdmin ? " (the admin user)" : ""}`);
  console.log("  Schema, indexes, constraints and migration history are unchanged.\n");
} finally {
  await prisma.$disconnect();
}
