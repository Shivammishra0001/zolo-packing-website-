// Backfill OrderItem.unitCostMinor for the imported historical order book.
//
// The spreadsheet recorded a cost per order. The import carried it into
// Order.notes as display text ("Recorded cost ₹12,050.00") because there was
// nowhere else to put it — OrderItem had no cost field until the
// order_item_cost_snapshot migration. This moves it into that column so profit
// becomes a real figure instead of something parsed out of a sentence.
//
// Reads the ORIGINAL JSON rather than re-parsing the notes string: the note is
// a rounded, localised rendering ("₹12,050.00"), and recovering a number from
// a display format is how rounding errors get baked in permanently.
//
//   node scripts/backfill-legacy-cost.mjs           # dry run
//   node scripts/backfill-legacy-cost.mjs --yes     # write
//
// IDEMPOTENT: only fills rows where unitCostMinor IS NULL, so a cost later
// corrected by hand in the admin UI is never overwritten by the spreadsheet.
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apply = process.argv.includes("--yes");
const prisma = new PrismaClient();
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data", "legacy-orders.json");

const paise = (rupees) => Math.round(Number(rupees ?? 0) * 100);
const inr = (minor) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

if (!existsSync(DATA)) {
  console.error(
    `\n✖ ${DATA} not found.\n` +
      "  It is gitignored (it holds real customer contact details), so it must\n" +
      "  be present locally to run this backfill.\n",
  );
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA, "utf8"));
const orders = [...data.orders, ...(data._openOrdersFromOctoberSheet ?? [])];

try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`\n  Target: ${url.hostname}${url.pathname}`);
  console.log(`  Mode:   ${apply ? "APPLY" : "dry run"}\n`);

  let matched = 0;
  let filled = 0;
  let already = 0;
  let noCost = 0;
  const missing = [];

  for (const o of orders) {
    // The order carries its spreadsheet id, which is how the import tagged it.
    const order = await prisma.order.findFirst({
      where: { notes: { contains: `[legacy:${o.legacyId}]` } },
      select: { id: true, orderNumber: true, items: { select: { id: true, quantity: true, unitCostMinor: true } } },
    });
    if (!order) {
      missing.push(o.legacyId);
      continue;
    }
    matched++;

    if (o.cost == null) {
      noCost++;
      continue;
    }
    // Every imported order is a single line, so the order's total cost is that
    // line's cost. Guard anyway rather than assume.
    if (order.items.length !== 1) {
      console.log(`  ! ${o.legacyId} has ${order.items.length} lines — skipped (cannot split a single cost figure)`);
      continue;
    }
    const item = order.items[0];
    if (item.unitCostMinor != null) {
      already++;
      continue;
    }

    // The sheet's cost is for the WHOLE order; the column is per unit.
    //
    // Integer paise per unit cannot always represent an order cost exactly:
    // ORD009 is 24,640 over 31,070 units, i.e. 0.793 paise each. Rounding to
    // the nearest paise and multiplying back drifts by -94.70 on that order
    // and -131.47 across the whole book — 0.02% of a 6.5 lakh cost base.
    //
    // Storing the per-unit figure is still right: it is what the column means,
    // it stays correct if a line is later split or part-returned, and a
    // per-order total would be wrong the moment quantity changed. The drift is
    // recorded here so a later reconciliation against the spreadsheet does not
    // read it as a defect.
    const unitCost = Math.round(paise(o.cost) / item.quantity);
    if (apply) {
      await prisma.orderItem.update({ where: { id: item.id }, data: { unitCostMinor: unitCost } });
    }
    filled++;
  }

  console.log(`  orders matched:        ${matched} of ${orders.length}`);
  console.log(`  cost filled:           ${filled}`);
  console.log(`  already had a cost:    ${already}`);
  console.log(`  no cost in the sheet:  ${noCost}`);
  if (missing.length) console.log(`  not found in the DB:   ${missing.join(", ")}`);

  if (apply) {
    const agg = await prisma.orderItem.aggregate({
      where: { unitCostMinor: { not: null } },
      _count: true,
    });
    const total = await prisma.orderItem.count();
    console.log(`\n  Lines with a recorded cost: ${agg._count} of ${total}`);
    console.log("  Profit is reported only for these; the rest show no margin rather than a zero one.\n");
  } else {
    console.log("\n  Dry run — nothing written. Re-run with --yes.\n");
  }
} finally {
  await prisma.$disconnect();
}
