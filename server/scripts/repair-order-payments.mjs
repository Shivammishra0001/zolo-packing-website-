// Restate Order.paidMinor / paymentStatus from the payment ledger.
//
// Two refund paths used to write the order's paymentStatus without touching
// paidMinor, and a third never restated the order at all:
//   * orders.adminCreateRefund    — set status, left paidMinor claiming the
//                                   money was still held
//   * returns.adminRefund         — no recompute whatsoever
// Both are fixed, but orders already written by them carry the drift, and
// every report built on paidMinor inherits it. One local order read PAID with
// 11,800 collected and nothing behind it.
//
// This recomputes each order from its own Payment and Refund rows using
// recomputeOrderPayment — the same function the live code paths use, so the
// repair cannot introduce a third interpretation of the ledger. No payment,
// refund or order total is altered: only the two derived fields.
//
//   node scripts/repair-order-payments.mjs         # dry run — lists drift
//   node scripts/repair-order-payments.mjs --yes   # restate
import { PrismaClient } from "@prisma/client";
import { recomputeOrderPayment } from "../src/services/crm.mjs";

const apply = process.argv.includes("--yes");
const prisma = new PrismaClient();

const PAID = new Set(["PAID", "SUCCESS"]);
const inr = (m) => `₹${(m / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`\n  Target: ${url.hostname}${url.pathname}`);
  console.log(`  Mode:   ${apply ? "APPLY" : "dry run"}\n`);

  const orders = await prisma.order.findMany({
    select: {
      id: true,
      orderNumber: true,
      paidMinor: true,
      grandTotalMinor: true,
      paymentStatus: true,
      payments: {
        select: { amountMinor: true, status: true, refunds: { select: { amountMinor: true, status: true } } },
      },
    },
  });

  const drifted = [];
  for (const o of orders) {
    // Mirrors recomputeOrderPayment exactly: receipts that count, minus
    // processed refunds booked against those same receipts.
    const counted = o.payments.filter((p) => PAID.has(p.status));
    const received = counted.reduce((s, p) => s + p.amountMinor, 0);
    const refunded = counted.reduce(
      (s, p) => s + p.refunds.filter((r) => r.status === "processed").reduce((n, r) => n + r.amountMinor, 0),
      0,
    );
    const expected = Math.max(0, received - refunded);
    if (expected !== o.paidMinor) drifted.push({ ...o, expected });
  }

  console.log(`  ${orders.length} orders checked, ${drifted.length} with drifted paidMinor`);
  for (const d of drifted.slice(0, 15)) {
    console.log(
      `    ${d.orderNumber.padEnd(14)} stored ${inr(d.paidMinor).padStart(14)} → ledger ${inr(d.expected).padStart(14)}  (${d.paymentStatus})`,
    );
  }
  if (drifted.length > 15) console.log(`    …and ${drifted.length - 15} more`);

  if (!apply) {
    console.log("\n  Dry run — nothing written. Re-run with --yes to restate.\n");
    process.exit(0);
  }

  let fixed = 0;
  for (const d of drifted) {
    // One transaction per order: a failure on one must not roll back the rest.
    await prisma.$transaction(async (tx) => {
      await recomputeOrderPayment(tx, d.id);
    });
    fixed++;
  }
  console.log(`\n  Restated ${fixed} order(s) from their payment ledgers.`);
  console.log("  No payment, refund or order total was modified.\n");
} finally {
  await prisma.$disconnect();
}
