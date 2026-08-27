// Seller settlement ledger.
//
// The chain is STORED, not recomputed at read time:
//   gross - commission - GST on commission - refunds = net payable
//
// A displayed-but-unrecorded payout has no id, date or bank reference, which
// makes a dispute unanswerable. Every cycle writes a row, and the commission
// it settles comes from the SNAPSHOT taken at order time — so repricing a
// product later can never restate a payout already made.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { recordEvent, notify } from "./events.mjs";

/** GST on the platform's commission (not on the goods). 18% in India. */
export const COMMISSION_TAX_BPS = 1800;

/** Settlement lag: orders become payable T+7 after delivery. */
export const SETTLEMENT_LAG_DAYS = 7;

const newPayoutNumber = () => `PO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/**
 * What a supplier has earned in a period, computed from delivered orders.
 *
 * Read-only — this is the preview. `createPayout` freezes the same figures
 * into a row.
 */
export async function previewPayout(supplierId, { periodStart, periodEnd }) {
  const from = new Date(periodStart);
  const to = new Date(periodEnd);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw badRequest("periodStart and periodEnd must be valid dates", "BAD_PERIOD");
  }
  if (from >= to) throw badRequest("periodStart must be before periodEnd", "BAD_PERIOD");

  // Resolve this supplier's own product ids first. OrderItem deliberately has
  // no `product` relation — it stores a productId reference plus a snapshot —
  // so the seller's catalogue is matched by id rather than joined through.
  const profile = await prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    select: { organizationId: true },
  });
  if (!profile) throw notFound("Supplier not found");
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: profile.organizationId },
    select: { userId: true },
  });
  const sellerUserIds = members.map((m) => m.userId);

  const sellerProducts = await prisma.product.findMany({
    where: { sellerId: { in: sellerUserIds } },
    select: { id: true },
  });
  const mineIds = new Set(sellerProducts.map((p) => p.id));

  let grossMinor = 0;
  let commissionMinor = 0;
  const orderIds = [];

  if (mineIds.size > 0) {
    // Only DELIVERED orders settle: money for goods still in transit is not
    // the seller's yet.
    const orders = await prisma.order.findMany({
      where: {
        status: "DELIVERED",
        updatedAt: { gte: from, lt: to },
        items: { some: { productId: { in: [...mineIds] } } },
      },
      select: {
        id: true,
        items: { select: { productId: true, commissionMinor: true, lineTotalMinor: true } },
      },
    });

    for (const o of orders) {
      const mine = o.items.filter((i) => i.productId && mineIds.has(i.productId));
      if (mine.length === 0) continue;
      grossMinor += mine.reduce((n, i) => n + i.lineTotalMinor, 0);
      commissionMinor += mine.reduce((n, i) => n + i.commissionMinor, 0);
      orderIds.push(o.id);
    }
  }

  const refundsMinor = await refundsInPeriod(orderIds);
  const taxOnCommissionMinor = Math.round((commissionMinor * COMMISSION_TAX_BPS) / 10_000);
  const netPayableMinor = grossMinor - commissionMinor - taxOnCommissionMinor - refundsMinor;

  return {
    supplierId,
    periodStart: from,
    periodEnd: to,
    grossMinor,
    commissionMinor,
    taxOnCommissionMinor,
    refundsMinor,
    netPayableMinor,
    orderIds,
    orderCount: orderIds.length,
  };
}

// Refunds hang off Payment, not Order, so this walks the relation. Only
// `processed` refunds have actually left the account — a requested or approved
// one must not reduce a settlement yet.
async function refundsInPeriod(orderIds) {
  if (orderIds.length === 0) return 0;
  const refunds = await prisma.refund.aggregate({
    where: { status: "processed", payment: { orderId: { in: orderIds } } },
    _sum: { amountMinor: true },
  });
  return refunds._sum.amountMinor ?? 0;
}

/**
 * Freeze a settlement cycle into a row.
 *
 * The figures are stored rather than recomputed on read, so a later refund or
 * commission change cannot silently restate a settlement that has been paid.
 */
export async function createPayout(adminId, supplierId, { periodStart, periodEnd, notes }) {
  const preview = await previewPayout(supplierId, { periodStart, periodEnd });

  const existing = await prisma.payout.findUnique({
    where: {
      supplierId_periodStart_periodEnd: {
        supplierId,
        periodStart: preview.periodStart,
        periodEnd: preview.periodEnd,
      },
    },
  });
  if (existing) throw conflict("A payout already exists for this period", "PAYOUT_EXISTS");
  if (preview.netPayableMinor < 0) {
    throw badRequest("Net payable is negative — refunds exceed earnings for this period", "NEGATIVE_PAYOUT");
  }

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.create({
      data: {
        payoutNumber: newPayoutNumber(),
        supplierId,
        periodStart: preview.periodStart,
        periodEnd: preview.periodEnd,
        grossMinor: preview.grossMinor,
        commissionMinor: preview.commissionMinor,
        taxOnCommissionMinor: preview.taxOnCommissionMinor,
        refundsMinor: preview.refundsMinor,
        netPayableMinor: preview.netPayableMinor,
        orderIds: preview.orderIds,
        notes: notes ?? null,
      },
    });
    await recordEvent(
      {
        eventType: "payout.created",
        actorId: adminId,
        entityType: "Payout",
        entityId: payout.id,
        metadata: { payoutNumber: payout.payoutNumber, netPayableMinor: payout.netPayableMinor },
      },
      tx,
    );
    return payout;
  });
}

/**
 * Record that a payout was actually transferred.
 *
 * The UTR is required: a settlement marked paid with no bank reference is
 * exactly the state that makes a dispute unanswerable.
 */
export async function markPaid(adminId, payoutId, { utr, paidAt }) {
  const reference = String(utr ?? "").trim();
  if (!reference) throw badRequest("A bank reference (UTR) is required to mark a payout paid", "UTR_REQUIRED");

  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return null;
  if (payout.status === "PAID") throw conflict("This payout is already paid", "ALREADY_PAID");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.payout.update({
      where: { id: payoutId },
      data: { status: "PAID", utr: reference, paidAt: paidAt ? new Date(paidAt) : new Date() },
    });
    await recordEvent(
      {
        eventType: "payout.paid",
        actorId: adminId,
        entityType: "Payout",
        entityId: payoutId,
        // The UTR is a bank reference, not a secret, and it is what makes the
        // audit trail useful.
        metadata: { payoutNumber: updated.payoutNumber, utr: reference, netPayableMinor: updated.netPayableMinor },
      },
      tx,
    );
    const profile = await tx.supplierProfile.findUnique({
      where: { id: updated.supplierId },
      select: { organizationId: true },
    });
    if (profile) {
      const members = await tx.organizationMember.findMany({
        where: { organizationId: profile.organizationId },
        select: { userId: true },
      });
      for (const m of members) {
        await notify(
          {
            userId: m.userId,
            type: "payout.paid",
            title: "Payout settled",
            body: `${updated.payoutNumber} has been transferred.`,
            entityType: "Payout",
            entityId: payoutId,
          },
          tx,
        );
      }
    }
    return updated;
  });
}

export async function updatePayoutStatus(adminId, payoutId, status) {
  const allowed = ["PENDING", "PROCESSING", "ON_HOLD", "FAILED"];
  if (!allowed.includes(status)) throw badRequest(`Status must be one of ${allowed.join(", ")}`, "BAD_STATUS");
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, select: { id: true, status: true } });
  if (!payout) return null;
  // PAID is terminal: reversing it would silently erase a recorded transfer.
  if (payout.status === "PAID") throw conflict("A paid payout cannot change status", "ALREADY_PAID");
  return prisma.payout.update({ where: { id: payoutId }, data: { status } });
}

export async function listPayouts({ supplierId, status, take = 50, skip = 0 } = {}) {
  const where = { ...(supplierId ? { supplierId } : {}), ...(status ? { status } : {}) };
  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      orderBy: { periodEnd: "desc" },
      take: Math.min(Number(take) || 50, 200),
      skip: Number(skip) || 0,
    }),
    prisma.payout.count({ where }),
  ]);
  return { payouts, total };
}

export const getPayout = (id) => prisma.payout.findUnique({ where: { id } });
