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

// Compute the discount a coupon yields on a given (pre-tax) subtotal. Returns
// { ok, discountMinor, reason } — reason is set only when the coupon is invalid.
export function evaluateCoupon(coupon, subtotalMinor, now = new Date()) {
  if (!coupon) return { ok: false, discountMinor: 0, reason: "Coupon not found" };
  if (!coupon.isActive || coupon.deletedAt) return { ok: false, discountMinor: 0, reason: "Coupon is not active" };
  if (coupon.validFrom && now < coupon.validFrom) return { ok: false, discountMinor: 0, reason: "Coupon is not yet valid" };
  if (coupon.validUntil && now > coupon.validUntil) return { ok: false, discountMinor: 0, reason: "Coupon has expired" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit)
    return { ok: false, discountMinor: 0, reason: "Coupon usage limit reached" };
  if (coupon.minOrderMinor != null && subtotalMinor < coupon.minOrderMinor)
    return { ok: false, discountMinor: 0, reason: "Order does not meet the coupon minimum" };

  let discount =
    coupon.discountType === "percent"
      ? Math.round((subtotalMinor * coupon.discountValue) / 10000) // discountValue is basis points (e.g. 1000 = 10%)
      : coupon.discountValue; // flat, already in minor units
  if (coupon.maxDiscountMinor != null) discount = Math.min(discount, coupon.maxDiscountMinor);
  discount = Math.min(discount, subtotalMinor); // never discount below zero
  return { ok: true, discountMinor: Math.max(0, discount), reason: null };
}

// The authoritative pricing engine. Given priced line items (each with a
// server-resolved unitPriceMinor + quantity) and an optional evaluated coupon
// discount, produce the full money breakdown. All integer paise.
export function priceOrder({ items, discountMinor = 0 }) {
  const subtotalMinor = items.reduce((s, it) => s + it.unitPriceMinor * it.quantity, 0);
  const clampedDiscount = Math.min(Math.max(0, discountMinor), subtotalMinor);
  const taxableMinor = subtotalMinor - clampedDiscount;
  const taxMinor = Math.round(taxableMinor * GST_RATE);
  const shippingMinor =
    subtotalMinor === 0 || subtotalMinor >= FREE_SHIP_THRESHOLD_MINOR ? 0 : FLAT_SHIP_MINOR;
  const grandTotalMinor = taxableMinor + taxMinor + shippingMinor;
  return { subtotalMinor, discountMinor: clampedDiscount, taxMinor, shippingMinor, grandTotalMinor };
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
