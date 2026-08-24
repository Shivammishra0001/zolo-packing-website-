// Inventory ledger.
//
// RULE: `Product.stock` is never written directly. Every change goes through
// `recordMovement`, which updates the product AND appends a StockMovement row
// inside one transaction. That makes on-hand stock explainable — you can always
// answer "why is this 480 and not 500?" by reading the ledger.
//
// Movements are append-only. A mistake is corrected by posting a compensating
// ADJUSTMENT, never by editing or deleting history.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "DISPATCH",
  "RETURN",
  "ADJUSTMENT",
  "DAMAGE",
];

// Which direction each type moves stock. ADJUSTMENT is the only signed type —
// a stock take can go either way — so callers must pass its sign explicitly.
const DIRECTION = {
  RECEIPT: 1,
  PRODUCTION_OUTPUT: 1,
  RETURN: 1,
  CONSUMPTION: -1,
  DISPATCH: -1,
  DAMAGE: -1,
  ADJUSTMENT: 0,
};

/**
 * Apply one stock movement.
 *
 * `quantity` is always supplied as a POSITIVE magnitude except for ADJUSTMENT,
 * where the sign carries the meaning. The signed delta is derived here so a
 * caller can never accidentally add stock while posting a DISPATCH.
 *
 * Accepts an optional `tx` so it can join a caller's transaction (e.g. order
 * placement writing a DISPATCH alongside the order rows).
 */
export async function recordMovement(
  { productId, type, quantity, reason = null, refType = null, refId = null, actorId = null },
  tx = prisma,
) {
  if (!MOVEMENT_TYPES.includes(type)) throw badRequest(`Unknown movement type: ${type}`);

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty === 0) throw badRequest("Movement quantity must be a non-zero integer");

  const direction = DIRECTION[type];
  if (direction === 0 && type !== "ADJUSTMENT") throw badRequest(`No direction defined for ${type}`);
  // For directional types the magnitude must be positive; the sign is ours.
  if (type !== "ADJUSTMENT" && qty < 0) throw badRequest(`${type} quantity must be positive — the direction is implied`);

  const delta = type === "ADJUSTMENT" ? qty : qty * direction;

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, stock: true, reservedStock: true },
  });
  if (!product) throw notFound("Product not found");

  // Opening balance. A product that already carried stock before the ledger
  // existed would otherwise show permanent drift, because no movement explains
  // where that stock came from. The first movement against such a product
  // posts an ADJUSTMENT for the pre-existing quantity, so the ledger sums to
  // Product.stock from this point on and history stays explainable.
  const hasHistory = (await tx.stockMovement.count({ where: { productId: product.id } })) > 0;
  if (!hasHistory && product.stock !== 0) {
    await tx.stockMovement.create({
      data: {
        productId: product.id,
        type: "ADJUSTMENT",
        quantity: product.stock,
        balance: product.stock,
        reason: "Opening balance (stock on hand before ledger tracking began)",
        refType: "opening",
        actorId,
      },
    });
  }

  const balance = product.stock + delta;
  if (balance < 0) {
    throw badRequest(
      `${type} of ${Math.abs(delta)} would take ${product.sku} below zero (on hand ${product.stock})`,
      "INSUFFICIENT_STOCK",
    );
  }

  await tx.product.update({ where: { id: product.id }, data: { stock: balance } });

  const movement = await tx.stockMovement.create({
    data: { productId: product.id, type, quantity: delta, balance, reason, refType, refId, actorId },
  });

  return { movement, product: { ...product, stock: balance } };
}

/** Admin-facing manual movement, with an audit event attached. */
export async function adminRecordMovement(actor, input) {
  return prisma.$transaction(async (tx) => {
    const { movement, product } = await recordMovement({ ...input, actorId: actor.id }, tx);

    await recordEvent(
      {
        eventType: "inventory.adjusted",
        actorId: actor.id,
        entityType: "Product",
        entityId: product.id,
        metadata: {
          sku: product.sku,
          type: movement.type,
          quantity: movement.quantity,
          balance: movement.balance,
          reason: movement.reason,
        },
      },
      tx,
    );

    return movement;
  });
}

/** Ledger for the Stock Movement tab: newest first, optionally per product. */
export async function listMovements({ productId = null, type = null, limit = 100, offset = 0 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const where = {
    ...(productId ? { productId } : {}),
    ...(type && MOVEMENT_TYPES.includes(type) ? { type } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        product: { select: { id: true, sku: true, name: true, imageEmoji: true } },
        actor: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return {
    movements: rows.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      balance: m.balance,
      reason: m.reason,
      refType: m.refType,
      refId: m.refId,
      createdAt: m.createdAt,
      productId: m.productId,
      sku: m.product?.sku ?? null,
      productName: m.product?.name ?? null,
      emoji: m.product?.imageEmoji ?? null,
      actor: m.actor
        ? [m.actor.firstName, m.actor.lastName].filter(Boolean).join(" ") || m.actor.email
        : "System",
    })),
    total,
  };
}

/**
 * Reconcile the ledger against Product.stock.
 *
 * Any drift means something wrote `stock` outside recordMovement — this is the
 * check that keeps the ledger honest rather than decorative.
 */
export async function reconcile({ limit = 500 } = {}) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, sku: true, name: true, stock: true },
    take: Math.min(Math.max(Number(limit) || 500, 1), 1000),
  });

  const sums = await prisma.stockMovement.groupBy({ by: ["productId"], _sum: { quantity: true } });
  const byProduct = new Map(sums.map((s) => [s.productId, s._sum.quantity ?? 0]));

  const drift = [];
  for (const p of products) {
    // A product with no ledger history simply isn't tracked yet — the ledger
    // starts at its first movement, which back-posts an opening balance.
    if (!byProduct.has(p.id)) continue;
    const ledger = byProduct.get(p.id);
    if (ledger !== p.stock) drift.push({ id: p.id, sku: p.sku, name: p.name, stock: p.stock, ledger });
  }

  return { checked: products.length, tracked: byProduct.size, drift };
}
