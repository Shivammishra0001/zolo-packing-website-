import type {
  Order,
  OrderTrackingStage,
  PaymentStatus,
  ProductionStatus,
} from "./types";

// ============================================================
// Order tracking metadata — single source of truth for the manufacturing
// lifecycle used by the tracking bar, the list columns and the buyer view.
// ============================================================

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export interface StageMeta {
  label: string;
  short: string;
}

export const TRACKING_STAGE: Record<OrderTrackingStage, StageMeta> = {
  order_received: { label: "Order Received", short: "Received" },
  payment_confirmed: { label: "Payment Confirmed", short: "Paid" },
  artwork_review: { label: "Artwork Review", short: "Artwork" },
  artwork_approved: { label: "Artwork Approved", short: "Approved" },
  material_allocated: { label: "Material Allocated", short: "Material" },
  production: { label: "Production", short: "Production" },
  printing: { label: "Printing", short: "Printing" },
  finishing: { label: "Finishing", short: "Finishing" },
  die_cutting: { label: "Die Cutting", short: "Die Cut" },
  qc: { label: "QC", short: "QC" },
  packing: { label: "Packing", short: "Packing" },
  ready_for_dispatch: { label: "Ready for Dispatch", short: "Ready" },
  dispatched: { label: "Dispatched", short: "Dispatched" },
  in_transit: { label: "In Transit", short: "In Transit" },
  delivered: { label: "Delivered", short: "Delivered" },
  cancelled: { label: "Cancelled", short: "Cancelled" },
};

/** Full manufacturing flow for custom packaging (excludes terminal "cancelled"). */
export const CUSTOM_FLOW: OrderTrackingStage[] = [
  "order_received",
  "payment_confirmed",
  "artwork_review",
  "artwork_approved",
  "material_allocated",
  "production",
  "printing",
  "finishing",
  "die_cutting",
  "qc",
  "packing",
  "ready_for_dispatch",
  "dispatched",
  "in_transit",
  "delivered",
];

/** Shorter flow for ready-stock products (no artwork / manufacturing detail). */
export const READY_STOCK_FLOW: OrderTrackingStage[] = [
  "order_received",
  "payment_confirmed",
  "packing",
  "ready_for_dispatch",
  "dispatched",
  "in_transit",
  "delivered",
];

/** The stage flow this order follows. */
export function flowFor(order: Order): OrderTrackingStage[] {
  return order.type === "ready_made" ? READY_STOCK_FLOW : CUSTOM_FLOW;
}

/** Index of a stage within an order's flow (−1 if not part of it). */
export function stageIndex(order: Order, stage: OrderTrackingStage): number {
  return flowFor(order).indexOf(stage);
}

export type StageState = "completed" | "current" | "upcoming";

/** Classify a stage relative to the order's current tracking stage. */
export function stageState(order: Order, stage: OrderTrackingStage): StageState {
  const flow = flowFor(order);
  const currentIdx = flow.indexOf(order.trackingStage ?? "order_received");
  const idx = flow.indexOf(stage);
  if (idx < currentIdx) return "completed";
  if (idx === currentIdx) return "current";
  return "upcoming";
}

// ---------- Payment / production status badge tones ----------

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "danger" },
  partial: { label: "Partial", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export const PRODUCTION_STATUS: Record<ProductionStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  on_hold: { label: "On Hold", tone: "warning" },
};

export const TRACKING_TONE: Record<OrderTrackingStage, Tone> = {
  order_received: "neutral",
  payment_confirmed: "info",
  artwork_review: "warning",
  artwork_approved: "info",
  material_allocated: "info",
  production: "primary",
  printing: "primary",
  finishing: "primary",
  die_cutting: "primary",
  qc: "info",
  packing: "info",
  ready_for_dispatch: "warning",
  dispatched: "success",
  in_transit: "primary",
  delivered: "success",
  cancelled: "danger",
};

// ---------- Buyer-facing simplified flow ----------
// The buyer dashboard shows a coarse flow; internal manufacturing stages map
// down to one of these. Never expose admin-only stage detail to buyers.
export type BuyerStage = "confirmed" | "production" | "qc" | "packed" | "shipped" | "delivered";

export const BUYER_STAGE_LABEL: Record<BuyerStage, string> = {
  confirmed: "Confirmed",
  production: "In Production",
  qc: "Quality Check",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
};

export const BUYER_FLOW: BuyerStage[] = ["confirmed", "production", "qc", "packed", "shipped", "delivered"];

/** Map an internal manufacturing stage to the simplified buyer stage. */
export function toBuyerStage(stage: OrderTrackingStage): BuyerStage {
  switch (stage) {
    case "order_received":
    case "payment_confirmed":
    case "artwork_review":
    case "artwork_approved":
    case "material_allocated":
      return "confirmed";
    case "production":
    case "printing":
    case "finishing":
    case "die_cutting":
      return "production";
    case "qc":
      return "qc";
    case "packing":
    case "ready_for_dispatch":
      return "packed";
    case "dispatched":
    case "in_transit":
      return "shipped";
    case "delivered":
      return "delivered";
    case "cancelled":
      return "confirmed"; // buyer sees a cancelled banner separately
  }
}

// ---------- Transition validation ----------

/**
 * Whether moving from → to is a forward step in the order's flow.
 * Backward moves are allowed but the UI must confirm them first.
 */
export function isForwardTransition(order: Order, to: OrderTrackingStage): boolean {
  if (to === "cancelled") return true;
  const flow = flowFor(order);
  const from = order.trackingStage ?? "order_received";
  return flow.indexOf(to) >= flow.indexOf(from);
}

/** Derive the coarse OrderStatus (for existing consumers) from a tracking stage. */
export function toOrderStatus(stage: OrderTrackingStage): Order["status"] {
  switch (stage) {
    case "order_received":
    case "payment_confirmed":
      return "confirmed";
    case "artwork_review":
      return "artwork_pending";
    case "artwork_approved":
    case "material_allocated":
      return "proof_approved";
    case "production":
    case "printing":
    case "finishing":
    case "die_cutting":
      return "in_production";
    case "qc":
      return "qc";
    case "packing":
    case "ready_for_dispatch":
      return "packed";
    case "dispatched":
    case "in_transit":
      return "dispatched";
    case "delivered":
      return "delivered";
    case "cancelled":
      return "confirmed";
  }
}
