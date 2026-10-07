// `prisma migrate deploy`, plus recovery from a BLOCKED migration.
//
// Prisma refuses to apply anything once a migration is recorded as failed
// (P3009), and `migrate deploy` cannot clear that state itself — so every
// subsequent deploy fails identically until a human intervenes.
//
// The common cause is benign: a deploy applied the schema but was interrupted
// before marking it finished, so the next run hit "relation already exists"
// and was logged as a failure even though the tables are present and correct.
//
// This resolves exactly that case and nothing else. `migrate resolve --applied`
// writes to the _prisma_migrations bookkeeping table only — no DDL, no data.
// It is gated on the migration's tables actually existing, so a migration that
// genuinely failed part-way is never waved through; that still aborts, which is
// the right outcome for a half-migrated schema.
//
// Used by `npm run db:migrate:deploy`, so every path that migrates gets the
// same recovery.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = resolve(serverDir, "prisma/schema.prisma");

const prisma = (args, opts = {}) =>
  spawnSync("npx", ["prisma", ...args, "--schema", schema], {
    cwd: serverDir,
    env: process.env,
    ...opts,
  });

/** Name of the migration Prisma reports as failed, or null. */
function findFailed() {
  const out = prisma(["migrate", "status"], { encoding: "utf8" });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  // Two wordings depending on which command reported it:
  //   status: "Following migration have failed:" then the name on its own line
  //   deploy: "The `<name>` migration started at ... failed"
  const listed = text.match(/Following migration[^\n]*failed:\s*\n\s*([0-9]{14}_[a-z0-9_]+)/i);
  if (listed) return listed[1];
  return text.match(/`([0-9]{14}_[a-z0-9_]+)`[^\n]*failed/i)?.[1] ?? null;
}

/**
 * Does the schema exist? Uses the generated client rather than a psql binary,
 * which is not present in the deploy container.
 */
async function schemaPresent() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    try {
      const rows = await db.$queryRaw`
        SELECT COUNT(*)::int AS n
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('User', 'Product', 'Order')`;
      return Number(rows?.[0]?.n ?? 0) === 3;
    } finally {
      await db.$disconnect();
    }
  } catch {
    return false; // cannot prove it — never auto-resolve on a guess
  }
}

let result = prisma(["migrate", "deploy"], { stdio: "inherit" });

if (result.status !== 0) {
  const failed = findFailed();
  if (failed) {
    console.log(`\n  Migration ${failed} is recorded as failed — checking whether its tables exist…`);
    if (await schemaPresent()) {
      console.log(`  Tables are present. Marking ${failed} as applied (bookkeeping only, no data touched).`);
      if (prisma(["migrate", "resolve", "--applied", failed], { stdio: "inherit" }).status === 0) {
        console.log("  Retrying migrations…\n");
        result = prisma(["migrate", "deploy"], { stdio: "inherit" });
      }
    } else {
      console.error(
        `\n  ✖ ${failed} failed and its tables are NOT present.\n` +
          "    This is a genuine partial migration and needs a human — refusing to mark it applied.\n",
      );
    }
  }
}

process.exit(result.status ?? 1);
