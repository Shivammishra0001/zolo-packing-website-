// Move existing uploads into the public/private split.
//
// Before this change every uploaded file lived in `uploads/` and was served
// statically, which meant KYC documents (GST/PAN/bank proof) were readable by
// anyone who knew or guessed the filename. Files are now sorted:
//
//   uploads/public/   product imagery      (still statically served)
//   uploads/private/  supplier documents   (only via an authorized route)
//
// Classification uses the database, not the file extension: any storageKey
// referenced by SupplierDocument is private, everything else is public. That
// way a PDF that is genuinely public content is not misfiled, and an image
// uploaded as a KYC document is not left exposed.
//
//   node --env-file=.env scripts/migrate-uploads-split.mjs            # dry run
//   node --env-file=.env scripts/migrate-uploads-split.mjs --apply
import { readdirSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.mjs";

const apply = process.argv.includes("--apply");
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS = join(__dirname, "..", "uploads");
const PUBLIC = join(UPLOADS, "public");
const PRIVATE = join(UPLOADS, "private");

async function main() {
  if (!existsSync(UPLOADS)) {
    console.log("No uploads directory — nothing to migrate.");
    return;
  }

  // Every key the database considers a supplier document.
  const docs = await prisma.supplierDocument.findMany({ select: { storageKey: true } });
  const privateKeys = new Set(docs.map((d) => d.storageKey));

  // Loose files still sitting at the top level of uploads/.
  const loose = readdirSync(UPLOADS).filter((name) => {
    const full = join(UPLOADS, name);
    return statSync(full).isFile() && !name.startsWith(".");
  });

  const toPrivate = loose.filter((f) => privateKeys.has(f));
  const toPublic = loose.filter((f) => !privateKeys.has(f));

  console.log(`loose files:        ${loose.length}`);
  console.log(`  -> private (KYC): ${toPrivate.length}`);
  console.log(`  -> public:        ${toPublic.length}`);

  // A document row whose file is already missing is worth surfacing.
  const missing = [...privateKeys].filter(
    (k) => !loose.includes(k) && !existsSync(join(PRIVATE, k)) && !existsSync(join(PUBLIC, k)),
  );
  if (missing.length) console.log(`  !! ${missing.length} document rows have no file on disk`);

  if (!apply) {
    console.log("\nDry run — nothing moved. Re-run with --apply.");
    return;
  }

  mkdirSync(PUBLIC, { recursive: true });
  mkdirSync(PRIVATE, { recursive: true });

  let moved = 0;
  for (const [files, dest] of [
    [toPrivate, PRIVATE],
    [toPublic, PUBLIC],
  ]) {
    for (const f of files) {
      const from = join(UPLOADS, f);
      const to = join(dest, f);
      if (existsSync(to)) continue; // already migrated
      renameSync(from, to);
      moved += 1;
    }
  }

  console.log(`\nMoved ${moved} files. Storage keys are unchanged, so no database update is needed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
