// Rupee input ⇄ paise, and the payment-status vocabulary shared by every CRM
// screen.
//
// All API money is integer PAISE. Admins type RUPEES. Every conversion goes
// through here so no screen invents its own rounding — a `Math.round(x * 100)`
// scattered across five forms is how ₹1,234.565 becomes two different numbers.

/**
 * Parse a rupee string from a form field into integer paise.
 * Returns null when the field is empty or not a number, so callers can tell
 * "nothing entered" from "entered zero".
 */
export function rupeesToMinor(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[₹,\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Round at the paise boundary, not after arithmetic, so 12.345 → 1235 paise
  // deterministically rather than depending on float drift.
  return Math.round(n * 100);
}

/** Paise → a plain editable rupee string ("125000" → "1250", not "₹1,250"). */
export function minorToRupeeInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const r = minor / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Line total mirroring the server: (unit × qty − discount) + tax, never < 0. */
export function lineTotalMinor(unitMinor: number, quantity: number, discountMinor = 0, taxMinor = 0): number {
  return Math.max(0, unitMinor * quantity - discountMinor) + taxMinor;
}

// ---------------------------------------------------------------------------
// Payment status vocabulary
// ---------------------------------------------------------------------------

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

/**
 * Tone per payment state (§57): paid → green, partial → amber, unpaid →
 * neutral, overdue → red. Refunds read as informational, not as failures.
 */
const TONE: Record<string, BadgeTone> = {
  PAID: "success",
  PARTIAL: "warning",
  PARTIALLY_PAID: "warning",
  UNPAID: "neutral",
  PENDING: "neutral",
  OVERDUE: "danger",
  FAILED: "danger",
  REFUNDED: "info",
  PARTIALLY_REFUNDED: "info",
  SUCCESS: "success",
};

/** Human labels — the stored enum names are not admin-facing copy. */
const LABEL: Record<string, string> = {
  PAID: "Paid",
  PARTIAL: "Partially paid",
  PARTIALLY_PAID: "Partially paid",
  UNPAID: "Unpaid",
  PENDING: "Unpaid",
  OVERDUE: "Overdue",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partly refunded",
  SUCCESS: "Paid",
};

export const paymentTone = (status: string): BadgeTone => TONE[status] ?? "neutral";
export const paymentLabel = (status: string): string => LABEL[status] ?? status;

/** Customer-level financial state (§49) — derived server-side, never set. */
export const financialTone = (status: string): BadgeTone =>
  status === "OVERDUE" ? "danger" : status === "PENDING" ? "warning" : "success";

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
  cod: "Cash on delivery",
  netbanking: "Net banking",
};
export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m;

const KIND_LABEL: Record<string, string> = {
  ADVANCE: "Advance",
  PARTIAL: "Part payment",
  FINAL: "Final payment",
  ADJUSTMENT: "Adjustment",
};
export const kindLabel = (k: string): string => KIND_LABEL[k] ?? k;

/**
 * Turn an API failure into something an admin can act on (§54).
 * Never surfaces a raw Prisma/database message.
 */
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const e = err as { code?: string; message?: string; status?: number };
  const byCode: Record<string, string> = {
    EMAIL_TAKEN: "A customer with this email already exists.",
    PHONE_TAKEN: "A customer with this phone number already exists.",
    EMAIL_INVALID: "Enter a valid email address.",
    PHONE_INVALID: "Enter a valid 10-digit phone number.",
    NAME_REQUIRED: "Customer name is required.",
    ITEMS_REQUIRED: "Add at least one item to the order.",
    ITEM_NAME_REQUIRED: "Choose a product or enter an item name.",
    QUANTITY_INVALID: "Quantity must be a whole number of 1 or more.",
    PRICE_INVALID: "Enter a valid unit price.",
    TOTAL_INVALID: "Order total must be greater than zero.",
    AMOUNT_INVALID: "Enter an amount greater than zero.",
    METHOD_INVALID: "Choose a valid payment method.",
    OVERPAYMENT: "That is more than the outstanding balance.",
    REFERENCE_DUPLICATE: "This transaction reference is already recorded on this order.",
    REFUND_TOO_LARGE: "Refund is more than the remaining refundable amount.",
    NOT_REFUNDABLE: "Only a settled payment can be refunded.",
    CUSTOMER_REQUIRED: "Choose a customer.",
    PRODUCT_NOT_FOUND: "That product no longer exists.",
  };
  if (e?.code && byCode[e.code]) return byCode[e.code];
  // The server's own validation messages are written for admins, so they are
  // safe to show; anything else (500s, network) falls back.
  if (e?.status && e.status >= 400 && e.status < 500 && e.message) return e.message;
  return fallback;
}
