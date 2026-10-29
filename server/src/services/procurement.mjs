// ===========================================================================
// Procurement — Zolo BUYING from suppliers.
//
// The mirror image of the customer order flow, and deliberately separate from
// it at every level:
//
//   Order / Payment   a customer buys from Zolo      — money IN  (receivable)
//   Payout            Zolo settles a seller's sales  — money OUT (commission)
//   PurchaseOrder /   Zolo buys from a supplier      — money OUT (payable)
//   SupplierPayment
//
// Sharing a table between these would make "what we owe" and "what we are
// owed" the same query, and the two would net into a figure that means
// nothing. They stay apart.
//
// Rules this module enforces, matching the rest of the codebase:
//   * Money is integer minor units (paise). No floats anywhere.
//   * Order-level totals are DERIVED from the lines, never assigned.
//   * `paidMinor` is DERIVED from the payment rows, never assigned.
//   * Line details are SNAPSHOT, so a later product rename or reprice cannot
//     restate a historical purchase order.
//   * Receiving goods writes the stock ledger, so on-hand quantity and the
//     purchase record can never disagree.
// ===========================================================================
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

const rand = (n) => randomBytes(n).toString("hex").toUpperCase().slice(0, n * 2);
/** Random, not sequential: two concurrent inserts must not collide. */
export const newPoNumber = () => `PUR-${rand(4)}`;
export const newGrnNumber = () => `GRN-${rand(4)}`;
export const newSupplierPaymentNumber = () => `SPY-${rand(4)}`;

const SETTLED = new Set(["PAID"]);
const PAYMENT_METHODS = new Set(["bank_transfer", "upi", "cheque", "cash", "other"]);

const int = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Restate a purchase order from its own lines and payments.
 *
 * The single place totals are written. Every mutation ends here, so the stored
 * figures cannot drift from the rows behind them — the same discipline
 * recomputeOrderPayment applies to customer orders.
 */
export async function recomputePurchaseOrder(tx, purchaseOrderId) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: true, payments: true },
  });
  if (!po) throw notFound("Purchase order not found");

  const subtotalMinor = po.items.reduce((s, i) => s + i.lineTotalMinor, 0);
  const grandTotalMinor = subtotalMinor + po.taxMinor + po.shippingMinor;
  const paidMinor = po.payments.filter((p) => SETTLED.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);

  // Receipt progress decides the status, so it always reflects what actually
  // arrived rather than what someone remembered to click.
  const anyReceived = po.items.some((i) => i.receivedQty > 0);
  const allReceived = po.items.length > 0 && po.items.every((i) => i.receivedQty >= i.quantity);

  let status = po.status;
  if (po.status !== "CANCELLED" && po.status !== "DRAFT") {
    status = allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "SENT";
  }

  return tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      subtotalMinor,
      grandTotalMinor,
      paidMinor,
      status,
      completedAt: status === "RECEIVED" ? (po.completedAt ?? new Date()) : null,
    },
    include: { items: true, payments: true, receipts: { include: { items: true } } },
  });
}

/** Build snapshot lines from admin input. */
async function buildItems(tx, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw badRequest("Add at least one item to the purchase order", "ITEMS_REQUIRED");
  }

  const ids = rawItems.map((i) => i.productId).filter(Boolean);
  const products = ids.length ? await tx.product.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  return rawItems.map((raw, idx) => {
    const quantity = int(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest(`Item ${idx + 1}: quantity must be a whole number of 1 or more`, "QUANTITY_INVALID");
    }

    let productId = null;
    let productName;
    let sku = null;
    let unitCostMinor;

    if (raw.productId) {
      const product = byId.get(raw.productId);
      if (!product) throw badRequest(`Item ${idx + 1}: product not found`, "PRODUCT_NOT_FOUND");
      productId = product.id;
      productName = product.name;
      sku = product.sku;
      // The catalogue cost is a default, not a rule — a supplier quotes what
      // they quote, and that is what the PO must record.
      unitCostMinor = raw.unitCostMinor == null ? (product.costMinor ?? 0) : int(raw.unitCostMinor);
    } else {
      productName = String(raw.productName ?? "").trim();
      if (!productName) throw badRequest(`Item ${idx + 1}: choose a product or enter an item name`, "ITEM_NAME_REQUIRED");
      sku = raw.sku?.trim() || null;
      unitCostMinor = int(raw.unitCostMinor);
    }

    if (!Number.isFinite(unitCostMinor) || unitCostMinor < 0) {
      throw badRequest(`Item ${idx + 1}: enter a valid unit cost`, "COST_INVALID");
    }

    return {
      productId,
      productName,
      sku,
      description: raw.description?.trim() || null,
      quantity,
      unitCostMinor,
      lineTotalMinor: unitCostMinor * quantity,
    };
  });
}

/** Raise a purchase order on a supplier. */
export async function createPurchaseOrder(adminUser, input = {}) {
  const supplierId = String(input.supplierId ?? "");
  if (!supplierId) throw badRequest("Choose a supplier", "SUPPLIER_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplierProfile.findUnique({ where: { id: supplierId } });
    if (!supplier) throw notFound("Supplier not found");

    const items = await buildItems(tx, input.items);
    const taxMinor = Math.max(0, int(input.taxMinor ?? 0) || 0);
    const shippingMinor = Math.max(0, int(input.shippingMinor ?? 0) || 0);

    const po = await tx.purchaseOrder.create({
      data: {
        poNumber: newPoNumber(),
        supplierId,
        // DRAFT unless the admin says to issue it straight away.
        status: input.send === true ? "SENT" : "DRAFT",
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        taxMinor,
        shippingMinor,
        notes: input.notes?.trim() || null,
        reference: input.reference?.trim() || null,
        createdById: adminUser.id,
        items: { create: items },
      },
    });

    const withTotals = await recomputePurchaseOrder(tx, po.id);

    await recordEvent({
      eventType: "procurement.po.created",
      actorId: adminUser.id,
      entityType: "PurchaseOrder",
      entityId: po.id,
      metadata: { poNumber: po.poNumber, supplierId, itemCount: items.length, grandTotalMinor: withTotals.grandTotalMinor },
    }, tx);

    return withTotals;
  });
}

/** Issue a draft purchase order to the supplier. */
export async function sendPurchaseOrder(adminUser, id) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound("Purchase order not found");
    if (po.status !== "DRAFT") throw conflict("This purchase order has already been issued", "ALREADY_SENT");

    await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT" } });
    await recordEvent({
      eventType: "procurement.po.sent",
      actorId: adminUser.id,
      entityType: "PurchaseOrder",
      entityId: id,
      metadata: { poNumber: po.poNumber },
    }, tx);
    return recomputePurchaseOrder(tx, id);
  });
}

/** Cancel a purchase order. Refused once anything has been delivered. */
export async function cancelPurchaseOrder(adminUser, id, reason = null) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw notFound("Purchase order not found");
    if (po.status === "CANCELLED") throw conflict("This purchase order is already cancelled", "ALREADY_CANCELLED");
    // Cancelling after delivery would orphan stock that is physically here.
    if (po.items.some((i) => i.receivedQty > 0)) {
      throw conflict("Goods have already been received against this order", "ALREADY_RECEIVED");
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason?.trim() || null },
    });
    await recordEvent({
      eventType: "procurement.po.cancelled",
      actorId: adminUser.id,
      entityType: "PurchaseOrder",
      entityId: id,
      metadata: { poNumber: po.poNumber, reason: reason ?? null },
    }, tx);
    return updated;
  });
}

/**
 * Record a delivery against a purchase order.
 *
 * Accepted goods enter stock through the SAME ledger every other movement
 * uses, so on-hand quantity and the purchase record cannot disagree. Rejected
 * goods are recorded but never enter stock — the discrepancy stays visible
 * instead of quietly vanishing.
 */
export async function receiveGoods(adminUser, purchaseOrderId, input = {}) {
  const lines = Array.isArray(input.items) ? input.items : [];
  if (lines.length === 0) throw badRequest("Record at least one received item", "ITEMS_REQUIRED");

  return prisma.$transaction(async (tx) => {
    // Lock the order: two receipts arriving together must not both read the
    // same outstanding quantity and both pass the over-receipt check.
    const locked = await tx.$queryRawUnsafe(`SELECT id FROM "PurchaseOrder" WHERE id = $1 FOR UPDATE`, purchaseOrderId);
    if (locked.length === 0) throw notFound("Purchase order not found");

    const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { items: true } });
    if (po.status === "DRAFT") throw conflict("Issue the purchase order before receiving goods", "NOT_SENT");
    if (po.status === "CANCELLED") throw conflict("This purchase order was cancelled", "CANCELLED");

    const byItemId = new Map(po.items.map((i) => [i.id, i]));
    const prepared = lines.map((raw, idx) => {
      const item = byItemId.get(String(raw.purchaseOrderItemId ?? ""));
      if (!item) throw badRequest(`Line ${idx + 1}: unknown purchase order item`, "ITEM_NOT_FOUND");

      const acceptedQty = int(raw.acceptedQty ?? 0) || 0;
      const rejectedQty = int(raw.rejectedQty ?? 0) || 0;
      if (acceptedQty < 0 || rejectedQty < 0) throw badRequest(`Line ${idx + 1}: quantities cannot be negative`, "QUANTITY_INVALID");
      if (acceptedQty + rejectedQty === 0) throw badRequest(`Line ${idx + 1}: record an accepted or rejected quantity`, "QUANTITY_REQUIRED");

      const outstanding = item.quantity - item.receivedQty;
      if (acceptedQty > outstanding) {
        throw badRequest(
          `Line ${idx + 1}: only ${outstanding} of "${item.productName}" is still outstanding`,
          "OVER_RECEIPT",
        );
      }
      return { item, acceptedQty, rejectedQty, remarks: raw.remarks?.trim() || null };
    });

    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber: newGrnNumber(),
        purchaseOrderId,
        receivedById: adminUser.id,
        notes: input.notes?.trim() || null,
        items: {
          create: prepared.map((p) => ({
            purchaseOrderItemId: p.item.id,
            acceptedQty: p.acceptedQty,
            rejectedQty: p.rejectedQty,
            remarks: p.remarks,
          })),
        },
      },
      include: { items: true },
    });

    for (const p of prepared) {
      await tx.purchaseOrderItem.update({
        where: { id: p.item.id },
        data: { receivedQty: { increment: p.acceptedQty } },
      });

      // Only ACCEPTED goods enter stock, and only for catalogue products — a
      // free-text line has nothing to increment.
      if (p.acceptedQty > 0 && p.item.productId) {
        const product = await tx.product.update({
          where: { id: p.item.productId },
          data: { stock: { increment: p.acceptedQty } },
          select: { stock: true },
        });
        await tx.stockMovement.create({
          data: {
            productId: p.item.productId,
            type: "RECEIPT",
            quantity: p.acceptedQty,
            balance: product.stock,
            reason: `Goods receipt ${receipt.receiptNumber}`,
            refType: "GoodsReceipt",
            refId: receipt.id,
            actorId: adminUser.id,
          },
        });
      }
    }

    await recordEvent({
      eventType: "procurement.goods.received",
      actorId: adminUser.id,
      entityType: "GoodsReceipt",
      entityId: receipt.id,
      metadata: {
        receiptNumber: receipt.receiptNumber,
        poNumber: po.poNumber,
        accepted: prepared.reduce((s, p) => s + p.acceptedQty, 0),
        rejected: prepared.reduce((s, p) => s + p.rejectedQty, 0),
      },
    }, tx);

    await recomputePurchaseOrder(tx, purchaseOrderId);
    return receipt;
  });
}

/**
 * Pay a supplier against a purchase order.
 *
 * Locked and checked against the ledger, exactly like customer payments: two
 * concurrent payments must not both pass the overpayment check.
 */
export async function recordSupplierPayment(adminUser, purchaseOrderId, input = {}) {
  const amountMinor = int(input.amountMinor);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw badRequest("Enter a payment amount greater than zero", "AMOUNT_INVALID");
  }
  const method = String(input.method ?? "bank_transfer");
  if (!PAYMENT_METHODS.has(method)) throw badRequest(`Unknown payment method: ${method}`, "METHOD_INVALID");

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe(`SELECT id FROM "PurchaseOrder" WHERE id = $1 FOR UPDATE`, purchaseOrderId);
    if (locked.length === 0) throw notFound("Purchase order not found");

    const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { payments: true } });
    if (po.status === "CANCELLED") throw conflict("This purchase order was cancelled", "CANCELLED");

    // Outstanding from the rows, not from the cached paidMinor, so a stale
    // figure can never authorise an overpayment.
    const paid = po.payments.filter((p) => SETTLED.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);
    const outstanding = po.grandTotalMinor - paid;
    if (!input.allowOverpayment && amountMinor > outstanding) {
      throw badRequest(
        `Payment exceeds the outstanding balance of ₹${(outstanding / 100).toLocaleString("en-IN")}`,
        "OVERPAYMENT",
      );
    }

    const reference = input.reference?.trim() || null;
    if (reference && po.payments.some((p) => p.reference && p.reference.toLowerCase() === reference.toLowerCase())) {
      throw conflict("This reference is already recorded on this purchase order", "REFERENCE_DUPLICATE");
    }

    const payment = await tx.supplierPayment.create({
      data: {
        paymentNumber: newSupplierPaymentNumber(),
        purchaseOrderId,
        supplierId: po.supplierId,
        amountMinor,
        method,
        status: "PAID",
        reference,
        notes: input.notes?.trim() || null,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        paidById: adminUser.id,
      },
    });

    await recordEvent({
      eventType: "procurement.payment.recorded",
      actorId: adminUser.id,
      entityType: "SupplierPayment",
      entityId: payment.id,
      metadata: { paymentNumber: payment.paymentNumber, poNumber: po.poNumber, amountMinor, method },
    }, tx);

    const updated = await recomputePurchaseOrder(tx, purchaseOrderId);
    return { payment, purchaseOrder: updated };
  });
}

/** Purchase orders, newest first, with optional supplier/status filters. */
export async function listPurchaseOrders(query = {}) {
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const page = Math.max(1, Number(query.page) || 1);

  const where = {};
  if (query.supplierId) where.supplierId = String(query.supplierId);
  if (query.status) where.status = String(query.status);
  const q = String(query.q ?? "").trim();
  if (q) {
    where.OR = [
      { poNumber: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { supplier: { displayName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { orderedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        supplier: { select: { id: true, displayName: true, contactPhone: true } },
        items: { select: { quantity: true, receivedQty: true } },
      },
    }),
  ]);

  return {
    purchaseOrders: rows.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      supplierName: po.supplier?.displayName ?? "—",
      status: po.status,
      orderedAt: po.orderedAt,
      expectedAt: po.expectedAt,
      itemCount: po.items.length,
      orderedQty: po.items.reduce((s, i) => s + i.quantity, 0),
      receivedQty: po.items.reduce((s, i) => s + i.receivedQty, 0),
      grandTotalMinor: po.grandTotalMinor,
      paidMinor: po.paidMinor,
      payableMinor: Math.max(0, po.grandTotalMinor - po.paidMinor),
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** One purchase order in full. */
export async function getPurchaseOrder(id) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, displayName: true, contactName: true, contactPhone: true, gstNumber: true } },
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      receipts: { orderBy: { receivedAt: "desc" }, include: { items: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!po) return null;
  return { ...po, payableMinor: Math.max(0, po.grandTotalMinor - po.paidMinor) };
}

/**
 * Per-supplier procurement totals.
 *
 * Cancelled orders are excluded — a cancelled PO is not money owed, and
 * counting it would overstate the payable on every supplier who ever had one.
 */
export async function supplierProcurementTotals(supplierIds = []) {
  if (supplierIds.length === 0) return new Map();

  const rows = await prisma.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: { supplierId: { in: supplierIds }, status: { not: "CANCELLED" } },
    _sum: { grandTotalMinor: true, paidMinor: true },
    _count: { _all: true },
  });

  return new Map(
    rows.map((r) => {
      const purchasedMinor = r._sum.grandTotalMinor ?? 0;
      const paidMinor = r._sum.paidMinor ?? 0;
      return [
        r.supplierId,
        {
          purchaseOrders: r._count._all,
          purchasedMinor,
          paidMinor,
          payableMinor: Math.max(0, purchasedMinor - paidMinor),
        },
      ];
    }),
  );
}
