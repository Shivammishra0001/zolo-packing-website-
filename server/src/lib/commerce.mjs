// Commerce primitives: authoritative money math, ID generation, and the
// single server-side pricing engine. The frontend NEVER supplies prices,
// discounts, tax, shipping, or totals — everything payable is computed here
// from catalog + coupon data read fresh from the database.
import { randomBytes } from "node:crypto";

// GST rate applied to the (discounted) taxable amount. Basis points → 18.00%.
export const GST_RATE = 0.18;
// Free shipping at/above this order value (paise); flat fee below it.
export const FREE_SHIP_THRESHOLD_MINOR = 100_000; // ₹1,000
export const FLAT_SHIP_MINOR = 5_00; // ₹5.00

// Short, human-facing, collision-resistant business identifiers.
const rand = (n) => randomBytes(n).toString("hex").toUpperCase().slice(0, n * 2);
export const newOrderNumber = () => `ORD-${rand(4)}`;
export const newPaymentNumber = () => `PAY-${rand(4)}`;

/**
 * Quotation number. Sequential numbers derived from max(QT-…) collide when two
 * quotes are created concurrently (both read the same max, both write the same
 * value, one dies on the @unique with P2002 -> a spurious 409). A random token
 * removes the race entirely, matching how order and payment numbers already
 * work in this file.
 */
export const newQuotationNumber = () => `QT-${rand(4)}`;
export const newShipmentNumber = () => `SHP-${rand(4)}`;
export const newCustomerCode = () => `CUST-${rand(4)}`;

// Effective unit price for a catalog product (sale price wins when set/positive).
export const effectiveUnitPriceMinor = (product) =>
  product.salePriceMinor && product.salePriceMinor > 0
    ? product.salePriceMinor
    : product.basePriceMinor;

/**
 * Effective status of anything scheduled with isDraft / isActive / start / end
 * (coupons and campaigns). ALWAYS derived here, on the server — the admin never
 * sets "expired" or "scheduled" by hand and the storefront never decides it.
 *
 *   draft      saved, never published
 *   expired    end is in the past (wins over paused: re-activating cannot help)
 *   paused     isActive = false
 *   scheduled  start is in the future
 *   active     live right now
 */
export function scheduleStatus({ isDraft, isActive, startAt, endAt }, now = new Date()) {
  if (isDraft) return "draft";
  if (endAt && now > endAt) return "expired";
  if (!isActive) return "paused";
  if (startAt && now < startAt) return "scheduled";
  return "active";
}

/** Coupon status = schedule status + the usage counter. */
export function couponStatus(coupon, now = new Date()) {
  if (coupon.deletedAt) return "archived";
  const base = scheduleStatus(
    { isDraft: coupon.isDraft, isActive: coupon.isActive, startAt: coupon.validFrom, endAt: coupon.validUntil },
    now,
  );
  if (base === "draft" || base === "expired" || base === "paused") return base;
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return "usage_limit_reached";
  return base;
}

const COUPON_STATUS_REASON = {
  archived: "Coupon is not active",
  draft: "Coupon is not active",
  paused: "Coupon is not active",
  scheduled: "Coupon is not yet valid",
  expired: "Coupon has expired",
  usage_limit_reached: "Coupon usage limit reached",
};

/**
 * The part of a cart a coupon may discount. `items` are server-priced lines
 * (see orders.buildPricedItems) carrying the product row. A coupon scoped to
 * categories also covers their subcategories, because a product carries both
 * its categoryId and its subcategoryId.
 */
export function couponEligibleSubtotal(coupon, items) {
  const productIds = new Set((coupon.products ?? []).map((r) => r.productId));
  const categoryIds = new Set((coupon.categories ?? []).map((r) => r.categoryId));
  let eligible = 0;
  for (const it of items) {
    const p = it.product ?? {};
    if (coupon.appliesTo === "products" && !productIds.has(it.productId)) continue;
    if (coupon.appliesTo === "categories" && !categoryIds.has(p.categoryId) && !categoryIds.has(p.subcategoryId)) continue;
    if (coupon.allowSaleItems === false && it.isSaleItem) continue;
    if (coupon.allowOtherDiscounts === false && it.isTierDiscounted) continue;
    eligible += it.lineTotalMinor;
  }
  return eligible;
}

// Compute the discount a coupon yields on a given (pre-tax) subtotal. Returns
// { ok, discountMinor, reason } — reason is set only when the coupon is invalid.
// `eligibleSubtotalMinor` is the slice of the cart the coupon may discount
// (defaults to the whole subtotal); the minimum-order rule always looks at the
// whole cart.
export function evaluateCoupon(coupon, subtotalMinor, now = new Date(), { eligibleSubtotalMinor = subtotalMinor } = {}) {
  const fail = (reason) => ({ ok: false, discountMinor: 0, reason });
  if (!coupon) return fail("Coupon not found");
  const status = couponStatus(coupon, now);
  if (status !== "active") return fail(COUPON_STATUS_REASON[status]);
  if (coupon.minOrderMinor != null && subtotalMinor < coupon.minOrderMinor)
    return fail("Order does not meet the coupon minimum");
  if (eligibleSubtotalMinor <= 0) return fail("Coupon does not apply to the items in your cart");

  let discount =
    coupon.discountType === "percent"
      ? Math.round((eligibleSubtotalMinor * coupon.discountValue) / 10000) // discountValue is basis points (e.g. 1000 = 10%)
      : coupon.discountValue; // flat, already in minor units
  if (coupon.maxDiscountMinor != null) discount = Math.min(discount, coupon.maxDiscountMinor);
  discount = Math.min(discount, eligibleSubtotalMinor); // never discount below zero
  return { ok: true, discountMinor: Math.max(0, discount), reason: null };
}

// The authoritative pricing engine. Given priced line items (each with a
// server-resolved unitPriceMinor + quantity) and an optional evaluated coupon
// discount, produce the full money breakdown. All integer paise.
export function priceOrder({ items, discountMinor = 0, codChargeMinor = 0 }) {
  const subtotalMinor = items.reduce((s, it) => s + it.unitPriceMinor * it.quantity, 0);
  const clampedDiscount = Math.min(Math.max(0, discountMinor), subtotalMinor);
  const taxableMinor = subtotalMinor - clampedDiscount;
  const taxMinor = Math.round(taxableMinor * GST_RATE);
  const shippingMinor =
    subtotalMinor === 0 || subtotalMinor >= FREE_SHIP_THRESHOLD_MINOR ? 0 : FLAT_SHIP_MINOR;
  // Optional cash-on-delivery surcharge from Payment Settings (0 for other methods).
  const cod = subtotalMinor === 0 ? 0 : Math.max(0, Math.round(Number(codChargeMinor) || 0));
  const grandTotalMinor = taxableMinor + taxMinor + shippingMinor + cod;
  return { subtotalMinor, discountMinor: clampedDiscount, taxMinor, shippingMinor, codChargeMinor: cod, grandTotalMinor };
}

// Order status transitions the buyer/admin may perform. Payment status is a
// SEPARATE axis and never mixed in here. Terminal states have no outgoing edges.
export const ORDER_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED"],
  RETURNED: [],
  CANCELLED: [],
};

export const canTransition = (from, to) => (ORDER_TRANSITIONS[from] || []).includes(to);

// Statuses at which a buyer may still cancel their own order (before dispatch).
export const CUSTOMER_CANCELLABLE = new Set(["PENDING", "CONFIRMED", "PROCESSING", "PACKED"]);
