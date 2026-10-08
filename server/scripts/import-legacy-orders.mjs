// Import the historical order book from the operations spreadsheet.
//
// Source: server/data/legacy-orders.json, transcribed from Zolopacking.pdf —
// the real trading record from 26/05/2026 to 08/10/2026. This is business
// history, not seed data: it is imported ONCE into a live database and is
// expected to be edited afterwards through the admin UI like any other order.
//
//   node scripts/import-legacy-orders.mjs            # dry run — reports only
//   node scripts/import-legacy-orders.mjs --yes      # perform the import
//
// IDEMPOTENT. Every imported row is tagged with its spreadsheet id in
// Order.notes ("[legacy:ORD001]") and every customer by a deterministic email,
// so a second run updates nothing and creates nothing. Re-running after a
// partial failure is safe.
//
// What it deliberately does NOT do:
//   * It does not create catalog Products. Each line is a CUSTOM order item
//     (isCustomItem, productId null) because these are bespoke print jobs
//     described by a free-text name, not SKUs anyone can reorder from a
//     catalogue. Inventing 40 half-specified Products would pollute the
//     storefront with items that have no price, image, stock or category.
//   * It does not import the vendor/purchase ledger (pages 17-18, 25) or the
//     salary sheet (page 22). Those are accounts-payable records and the schema
//     has no model for them; faking one would be building something unasked.
//   * It does not touch the admin user, the schema, or migration history.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newOrderNumber, newPaymentNumber } from "../src/lib/commerce.mjs";

const apply = process.argv.includes("--yes");
const prisma = new PrismaClient();

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(HERE, "..", "data", "legacy-orders.json"), "utf8"));

// ---------------------------------------------------------------------------
// Conventions
// ---------------------------------------------------------------------------

/**
 * Rupees → integer paise. The sheet carries values like 11962.5 and 29820.7,
 * so a plain `* 100` leaves float dust (2982069.9999999995). Round once, here,
 * and never let a float past this boundary.
 */
const paise = (rupees) => Math.round(Number(rupees ?? 0) * 100);

const inr = (minor) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/**
 * A stable, obviously-synthetic email per customer. The spreadsheet has no
 * email addresses, but User.email is unique and required, so one has to be
 * derived. Using the customer key (not the name) keeps it stable if a display
 * name is later corrected, and the domain makes it unmistakable in the admin UI
 * that this address is a placeholder rather than a real contact.
 */
const emailFor = (key) => `${key}@legacy.zolopacking.invalid`;

/** The marker that makes this import idempotent and auditable. */
const tag = (legacyId) => `[legacy:${legacyId}]`;

/**
 * Phone numbers are stored normalised to the last 10 digits and are UNIQUE, so
 * two customers cannot share one. The sheet gives Rajesh (RKE) the same number
 * as Mohd. Irfan Salim — almost certainly a copy-paste error in the source. The
 * second claimant keeps no phone rather than having the first one's record
 * silently merged into theirs.
 */
const normalizePhone = (raw) => {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Decide what each order was actually paid, for every order at once.
 *
 * Two sources describe the same money and they are shaped differently:
 *
 *   - the master ledger's "Amount Received" column — one figure PER ORDER;
 *   - the receipts sheet — dated individual payments, which turn out to be
 *     recorded PER CUSTOMER ACCOUNT, not per order. Rahul Dangi's three
 *     receipts total 41,000 against ORD020's 13,608 but exactly match
 *     ORD020 + ORD021 (41,534) together; Irfan's 40,000 spans ORD018+ORD019.
 *     Matching a receipt to the single order id written beside it therefore
 *     overstates that order and leaves its sibling looking unpaid.
 *
 * So receipts are pooled per customer and allocated oldest-order-first, which
 * is how a running account is actually settled. Each order's allocation is
 * capped at the ledger figure where one exists, so a customer-level pool can
 * never make an order look more paid than the business recorded — except where
 * the ledger column is plainly a typo (Ramesh Tiwari: 200 recorded against
 * 14,000 genuinely received across two dated receipts), which is reported.
 *
 * Returns a Map of legacyId → { rows, notes }, rows being Payment-ready.
 */
function reconcileAll(orders, receipts) {
  const out = new Map(orders.map((o) => [o.legacyId, { rows: [], notes: [] }]));

  // Pool receipts by the customer of the order they name.
  const orderById = new Map(orders.map((o) => [o.legacyId, o]));
  const pool = new Map(); // customerKey -> receipt[]
  for (const r of receipts) {
    const o = orderById.get(r.legacyId);
    if (!o) {
      out.get(orders[0].legacyId)?.notes.push(`receipt of ${inr(paise(r.amount))} on ${r.date} names unknown order ${r.legacyId}`);
      continue;
    }
    if (!pool.has(o.customer)) pool.set(o.customer, []);
    pool.get(o.customer).push(r);
  }

  for (const [customerKey, rows] of pool) {
    // Oldest first, so the earliest debt is settled first.
    const theirs = orders
      .filter((o) => o.customer === customerKey)
      .sort((a, b) => a.date.localeCompare(b.date) || a.legacyId.localeCompare(b.legacyId));
    const dated = rows.slice().sort((a, b) => a.date.localeCompare(b.date));

    // Allocation ceiling per order: the ledger figure, or the order total when
    // the ledger figure is obviously wrong (receipts for this customer exceed
    // the sum of their ledger figures).
    const ledgerTotal = theirs.reduce((s, o) => s + paise(o.received), 0);
    const receiptTotal = dated.reduce((s, r) => s + paise(r.amount), 0);
    const ledgerUnderstated = receiptTotal > ledgerTotal;

    const capFor = (o) =>
      ledgerUnderstated ? Math.max(paise(o.received), paise(o.rate) * o.qty) : paise(o.received);

    let idx = 0;
    for (const r of dated) {
      let left = paise(r.amount);
      while (left > 0 && idx < theirs.length) {
        const target = theirs[idx];
        const bucket = out.get(target.legacyId);
        const taken = bucket.rows.reduce((s, x) => s + x.amountMinor, 0);
        const room = capFor(target) - taken;
        if (room <= 0) { idx++; continue; }
        const give = Math.min(room, left);
        bucket.rows.push({
          amountMinor: give,
          paidAt: new Date(`${r.date}T00:00:00.000Z`),
          notes:
            `From ${r.from}${r.to ? ` → ${r.to}` : ""}` +
            (give < paise(r.amount) ? ` (part of ${inr(paise(r.amount))} received on this date)` : ""),
          kind: "PARTIAL",
        });
        left -= give;
        if (give === room) idx++;
      }
      if (left > 0) {
        // More money than this customer's orders can absorb. Never discard it:
        // put it on their most recent order and say so.
        const last = theirs[theirs.length - 1];
        out.get(last.legacyId).rows.push({
          amountMinor: left,
          paidAt: new Date(`${r.date}T00:00:00.000Z`),
          notes: `From ${r.from} — unallocated surplus beyond the recorded order values`,
          kind: "ADJUSTMENT",
        });
        out.get(last.legacyId).notes.push(`${inr(left)} received beyond this customer's recorded order totals`);
      }
    }

    if (ledgerUnderstated) {
      out
        .get(theirs[0].legacyId)
        .notes.push(
          `dated receipts total ${inr(receiptTotal)} but the ledger column records only ${inr(ledgerTotal)} ` +
            `across this customer's ${theirs.length} order(s) — trusted the receipts`,
        );
    }
  }

  // Orders with a ledger figure but no dated receipt at all: the column is the
  // only evidence that money arrived, so it becomes one opening entry.
  for (const o of orders) {
    const bucket = out.get(o.legacyId);
    if (bucket.rows.length > 0) continue;
    const led = paise(o.received);
    if (led <= 0) continue;
    bucket.rows.push({
      amountMinor: led,
      paidAt: new Date(`${o.date}T00:00:00.000Z`),
      notes: "Opening balance from the master ledger (no dated receipt in the source)",
      kind: "FINAL",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const report = { customers: 0, customersSkipped: 0, orders: 0, ordersSkipped: 0, payments: 0, warnings: [] };
const warn = (m) => report.warnings.push(m);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("\n✖ DATABASE_URL is not set.\n");
    process.exit(1);
  }
  const parsed = new URL(url);
  console.log("\n  Target");
  console.log(`    host:     ${parsed.hostname}`);
  console.log(`    database: ${parsed.pathname.slice(1)}`);
  console.log(`    mode:     ${apply ? "APPLY" : "dry run"}`);

  // The admin owns every imported record (createdById / receivedById). Reuse
  // the real admin rather than inventing an importer identity.
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!admin) {
    console.error("\n✖ No admin user found. Run `npm run seed:admin` first.\n");
    process.exit(1);
  }
  console.log(`    admin:    ${admin.email}\n`);

  // ---- Customers -----------------------------------------------------------
  const customerIdByKey = new Map();
  const phonesTaken = new Set();

  for (const c of data.customers) {
    const email = emailFor(c.key);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      customerIdByKey.set(c.key, existing.id);
      report.customersSkipped++;
      continue;
    }

    let phone = normalizePhone(c.phone);
    if (phone && (phonesTaken.has(phone) || (await prisma.user.findUnique({ where: { phone } })))) {
      warn(`${c.name}: phone ${phone} already belongs to another customer — imported without a phone number`);
      phone = null;
    }
    if (!c.phone) warn(`${c.name}: no phone number in the spreadsheet — needs filling in`);
    if (phone) phonesTaken.add(phone);

    const [firstName, ...rest] = c.name.split(/\s+/);
    if (apply) {
      const user = await prisma.user.create({
        data: {
          email,
          phone,
          firstName,
          lastName: rest.join(" ") || null,
          // Unusable by construction: bcrypt never produces this string, so no
          // password matches it. These are walk-in trade customers who have
          // never had a login; they set one through the normal reset flow.
          passwordHash: "!legacy-import:no-login",
          role: "buyer",
          company: c.company || null,
          businessType: "business",
          preferences: { legacyImport: true },
        },
      });
      customerIdByKey.set(c.key, user.id);
    } else {
      customerIdByKey.set(c.key, `dry-run:${c.key}`);
    }
    report.customers++;
  }

  // ---- Orders --------------------------------------------------------------
  const allOrders = [...data.orders, ...data._openOrdersFromOctoberSheet];

  // Reconcile the whole book in one pass: receipts are per-customer-account,
  // so an order's payments cannot be decided by looking at that order alone.
  const reconciled = reconcileAll(allOrders, data.receipts);
  const salesIdByName = new Map();

  for (const o of allOrders) {
    const marker = tag(o.legacyId);
    if (await prisma.order.findFirst({ where: { notes: { contains: marker } } })) {
      report.ordersSkipped++;
      continue;
    }

    const userId = customerIdByKey.get(o.customer);
    if (!userId) {
      warn(`${o.legacyId}: unknown customer key "${o.customer}" — skipped`);
      continue;
    }
    const customer = data.customers.find((c) => c.key === o.customer);

    // Line money. The sheet's "Sale" is qty × rate, but rounding in the source
    // means they occasionally disagree by a rupee or two (ORD042: 3424 × 4.4 =
    // 15065.6 against a recorded 15065). qty × rate is authoritative because it
    // is what the two columns the business actually negotiated imply.
    const unitPriceMinor = paise(o.rate);
    const lineTotalMinor = unitPriceMinor * o.qty;
    const sheetSaleMinor = paise(o.sale);
    if (Math.abs(lineTotalMinor - sheetSaleMinor) > 100) {
      warn(
        `${o.legacyId}: qty × rate = ${inr(lineTotalMinor)} but the sheet records ${inr(sheetSaleMinor)} ` +
          `— used ${inr(lineTotalMinor)}`,
      );
    }

    // No GST is applied. The sheet records no tax column, and its "Sale" figure
    // is what the customer was billed; adding 18% here would overstate every
    // historical total and every outstanding balance by that much.
    const grandTotalMinor = lineTotalMinor;

    const { rows: paymentRows, notes: payNotes } = reconciled.get(o.legacyId);
    for (const n of payNotes) warn(`${o.legacyId}: ${n}`);

    const notesParts = [marker];
    if (o.remarks) notesParts.push(o.remarks);
    if (o.collectionStatus) notesParts.push(`Collection: ${o.collectionStatus}`);
    if (o.cost != null) notesParts.push(`Recorded cost ${inr(paise(o.cost))}`);
    if (o.receivedBy) notesParts.push(`Payment received by ${o.receivedBy}`);

    if (!apply) {
      report.orders++;
      report.payments += paymentRows.length;
      continue;
    }

    // Field sales rep, created on first use so Orders can carry salespersonId.
    let salespersonId = null;
    if (o.salesperson) {
      if (!salesIdByName.has(o.salesperson)) {
        const spec = data.salespeople.find((s) => s.name === o.salesperson);
        const spEmail = `${o.salesperson.toLowerCase().replace(/\s+/g, ".")}@legacy.zolopacking.invalid`;
        let sp = await prisma.user.findUnique({ where: { email: spEmail } });
        if (!sp) {
          const spPhone = normalizePhone(spec?.phone);
          const phoneFree = spPhone && !(await prisma.user.findUnique({ where: { phone: spPhone } }));
          const [fn, ...rn] = o.salesperson.split(/\s+/);
          sp = await prisma.user.create({
            data: {
              email: spEmail,
              phone: phoneFree ? spPhone : null,
              firstName: fn,
              lastName: rn.join(" ") || null,
              passwordHash: "!legacy-import:no-login",
              role: "salesperson",
              preferences: { legacyImport: true },
            },
          });
        }
        salesIdByName.set(o.salesperson, sp.id);
      }
      salespersonId = salesIdByName.get(o.salesperson);
    }

    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber: newOrderNumber(),
          userId,
          status: o.status ?? "DELIVERED",
          subtotalMinor: lineTotalMinor,
          discountMinor: 0,
          taxMinor: 0,
          shippingMinor: 0,
          grandTotalMinor,
          // paidMinor / paymentStatus are DERIVED from the Payment rows below —
          // never assigned here (see crm.recomputeOrderPayment).
          paymentMethod: o.paymentMode === "upi" ? "upi" : "cash",
          currency: "INR",
          notes: notesParts.join(" · "),
          source: "offline",
          createdById: admin.id,
          salespersonId,
          placedAt: new Date(`${o.date}T00:00:00.000Z`),
          expectedDeliveryDate: o.deliveryDate ? new Date(`${o.deliveryDate}T00:00:00.000Z`) : null,
          customerEmail: emailFor(o.customer),
          shipName: customer?.name ?? null,
          shipPhone: normalizePhone(customer?.phone),
          shipCountry: "India",
          items: {
            create: [
              {
                // Custom line: these are bespoke print jobs, not catalog SKUs.
                productId: null,
                isCustomItem: true,
                productName: o.product,
                quantity: o.qty,
                unitPriceMinor,
                lineTotalMinor,
                specs: {},
              },
            ],
          },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: order.status,
          note: `Imported from the operations spreadsheet (${o.legacyId})`,
          actorId: admin.id,
        },
      });

      for (const p of paymentRows) {
        await tx.payment.create({
          data: {
            paymentNumber: newPaymentNumber(),
            orderId: order.id,
            method: o.paymentMode === "upi" ? "upi" : "cash",
            amountMinor: p.amountMinor,
            status: "PAID",
            kind: p.kind,
            paidAt: p.paidAt,
            notes: p.notes,
            receivedById: admin.id,
          },
        });
        report.payments++;
      }

      // Derive paidMinor / paymentStatus from the rows just written, using the
      // same rule the CRM uses everywhere else rather than a second copy of it.
      const { recomputeOrderPayment } = await import("../src/services/crm.mjs");
      await recomputeOrderPayment(tx, order.id);
    });

    report.orders++;
  }

  // ---- Report --------------------------------------------------------------
  console.log("  Result");
  console.log(`    customers created:  ${report.customers}`);
  console.log(`    customers existing: ${report.customersSkipped}`);
  console.log(`    orders created:     ${report.orders}`);
  console.log(`    orders existing:    ${report.ordersSkipped}`);
  console.log(`    payments created:   ${report.payments}`);

  if (report.warnings.length) {
    console.log(`\n  ${report.warnings.length} data note(s) from the spreadsheet:`);
    for (const w of report.warnings) console.log(`    • ${w}`);
  }

  if (apply) {
    // Scoped to rows THIS import owns. `source: "offline"` would also sweep in
    // any offline order raised through the admin UI and overstate the book.
    const totals = await prisma.order.aggregate({
      where: { notes: { contains: "[legacy:" } },
      _sum: { grandTotalMinor: true, paidMinor: true },
      _count: true,
    });
    const billed = totals._sum.grandTotalMinor ?? 0;
    const paid = totals._sum.paidMinor ?? 0;
    console.log(`\n  Imported book: ${totals._count} orders`);
    console.log(`    billed:      ${inr(billed)}`);
    console.log(`    received:    ${inr(paid)}`);
    console.log(`    outstanding: ${inr(billed - paid)}\n`);
  } else {
    console.log("\n  Dry run — nothing was written. Re-run with --yes to import.\n");
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
