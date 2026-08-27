// Tiered B2B pricing + commission.
//
// Both are decided HERE, server-side. A browser never sends a price or a
// commission amount — it sends a productId and a quantity, and this module
// resolves what that actually costs.
//
// Money is integer minor units (paise). Commission is integer BASIS POINTS
// (800 = 8.00%), so a rate never suffers floating-point drift either.
import { prisma } from "../lib/prisma.mjs";
import { badRequest } from "../lib/http.mjs";

/** Platform fallback when a product carries no explicit rate. */
export const DEFAULT_COMMISSION_BPS = 800; // 8.00%

/**
 * Resolve the unit price for a quantity against a product's tier ladder.
 *
 * The HIGHEST minQty not exceeding `quantity` wins; below the first tier the
 * product's base price applies. Tiers may arrive in any order — this sorts
 * rather than trusting query order.
 *
 * @param {{basePriceMinor:number, priceTiers?:Array<{minQty:number,unitPriceMinor:number}>}} product
 * @param {number} quantity
 */
export function resolveUnitPriceMinor(product, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw badRequest("Quantity must be a positive whole number", "BAD_QUANTITY");

  const tiers = [...(product.priceTiers ?? [])]
    .filter((t) => Number.isInteger(t.minQty) && t.minQty > 0)
    .sort((a, b) => a.minQty - b.minQty);

  let price = product.basePriceMinor ?? 0;
  for (const t of tiers) {
    if (qty >= t.minQty) price = t.unitPriceMinor;
    else break; // ascending, so the first miss ends it
  }
  return price;
}

/** Commission in paise for a line total, at the given basis-point rate. */
export function commissionFor(lineTotalMinor, bps) {
  const rate = Number.isInteger(bps) ? bps : DEFAULT_COMMISSION_BPS;
  // Integer maths end to end; round once at the final division.
  return Math.round((Number(lineTotalMinor) * rate) / 10_000);
}

/** The rate that applies to a product, falling back to the platform default. */
export const commissionBpsFor = (product) =>
  Number.isInteger(product?.commissionBps) ? product.commissionBps : DEFAULT_COMMISSION_BPS;

/**
 * Price a basket of { productId, quantity } against live tiers.
 * Returns one priced line per input, with commission already resolved.
 */
export async function priceLines(items) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { priceTiers: { orderBy: { minQty: "asc" } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return items.map((i) => {
    const p = byId.get(i.productId);
    if (!p) throw badRequest(`Unknown product: ${i.productId}`, "PRODUCT_NOT_FOUND");
    const unitPriceMinor = resolveUnitPriceMinor(p, i.quantity);
    const lineTotalMinor = unitPriceMinor * i.quantity;
    const bps = commissionBpsFor(p);
    return {
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      quantity: i.quantity,
      unitPriceMinor,
      lineTotalMinor,
      commissionBps: bps,
      commissionMinor: commissionFor(lineTotalMinor, bps),
    };
  });
}

// ---- Admin: manage a product's ladder -----------------------------------

export async function listTiers(productId) {
  return prisma.priceTier.findMany({ where: { productId }, orderBy: { minQty: "asc" } });
}

/**
 * Replace a product's whole ladder in one transaction.
 *
 * Replacing rather than patching keeps the ladder coherent: a half-applied
 * edit could leave two tiers claiming the same threshold, or a gap that
 * silently reprices orders.
 */
export async function setTiers(productId, tiers) {
  if (!Array.isArray(tiers)) throw badRequest("tiers must be an array", "BAD_TIERS");

  const seen = new Set();
  const clean = tiers.map((t) => {
    const minQty = Number(t.minQty);
    const unitPriceMinor = Number(t.unitPriceMinor);
    if (!Number.isInteger(minQty) || minQty <= 0) throw badRequest("Each tier needs a positive whole minQty", "BAD_TIER_QTY");
    if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
      throw badRequest("Each tier needs a unit price in paise", "BAD_TIER_PRICE");
    }
    if (seen.has(minQty)) throw badRequest(`Duplicate tier quantity: ${minQty}`, "DUPLICATE_TIER");
    seen.add(minQty);
    return { productId, minQty, unitPriceMinor };
  });

  return prisma.$transaction(async (tx) => {
    await tx.priceTier.deleteMany({ where: { productId } });
    if (clean.length) await tx.priceTier.createMany({ data: clean });
    return tx.priceTier.findMany({ where: { productId }, orderBy: { minQty: "asc" } });
  });
}

/** Admin sets the commission rate for one product. */
export async function setCommissionBps(productId, bps) {
  const rate = Number(bps);
  if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) {
    throw badRequest("Commission must be whole basis points between 0 and 10000", "BAD_COMMISSION");
  }
  return prisma.product.update({
    where: { id: productId },
    data: { commissionBps: rate },
    select: { id: true, sku: true, name: true, commissionBps: true },
  });
}
