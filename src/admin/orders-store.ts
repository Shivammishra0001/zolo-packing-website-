import { useSyncExternalStore } from "react";
import { orders as seed } from "./mock-data";
import {
  flowFor,
  toOrderStatus,
} from "./orders-tracking";
import type {
  Order,
  OrderHistoryEntry,
  OrderTrackingStage,
  PaymentStatus,
  ProductionStatus,
} from "./types";

// ============================================================
// Orders store — in-memory, subscribable, seeded from mock data and enriched
// with the fine-grained tracking fields the ERP order screens need.
//
// FRONTEND-ONLY mock state. Status updates mutate here and flow to every
// subscribed view (list, detail, and later the buyer dashboard) with no backend.
//
// TODO(backend): replace mutators with API calls
//   - PATCH /api/orders/:id/status { stage, note, notifyCustomer }
//   - GET   /api/orders            (list, paginated + filtered server-side)
//   - GET   /api/orders/:id        (detail)
//   Reconcile optimistic updates here with server responses.
// ============================================================

// ---------- Derive tracking fields from the coarse seed data ----------

const STATUS_TO_STAGE: Record<Order["status"], OrderTrackingStage> = {
  confirmed: "payment_confirmed",
  artwork_pending: "artwork_review",
  proof_approved: "material_allocated",
  in_production: "production",
  qc: "qc",
  packed: "packing",
  dispatched: "in_transit",
  delivered: "delivered",
};

const IMAGE_BY_BOX: Record<string, string> = {
  "Mailer Box": "📦",
  "Rigid Box": "🎁",
  "Product Box (Tuck End)": "📮",
  "Sleeve + Tray": "🍫",
  "Corrugated Shipper": "📦",
};

function paymentStatusFor(o: Order): PaymentStatus {
  if (o.amountPaid >= o.total) return "paid";
  if (o.amountPaid > 0) return "partial";
  return "pending";
}

function productionStatusFor(stage: OrderTrackingStage): ProductionStatus {
  const producing: OrderTrackingStage[] = ["production", "printing", "finishing", "die_cutting"];
  const done: OrderTrackingStage[] = ["qc", "packing", "ready_for_dispatch", "dispatched", "in_transit", "delivered"];
  if (producing.includes(stage)) return "in_progress";
  if (done.includes(stage)) return "completed";
  return "not_started";
}

/** Build a plausible history from the order's activity + reached stages. */
function buildHistory(o: Order, stage: OrderTrackingStage): OrderHistoryEntry[] {
  const flow = flowFor(o);
  const reachedIdx = flow.indexOf(stage);
  const stamps = o.stageTimestamps ?? {};
  const hist: OrderHistoryEntry[] = [];
  const placed = new Date(o.placedAt).getTime();
  for (let i = 0; i <= reachedIdx && i < flow.length; i++) {
    const s = flow[i];
    const at = stamps[s] ?? new Date(placed + i * 6 * 3_600_000).toISOString();
    hist.push({
      id: `${o.id}-h${i}`,
      at,
      action: i === 0 ? "Order placed" : `Advanced to ${s.replace(/_/g, " ")}`,
      by: i === 0 ? "System" : ["Kavita (CS)", "Floor Supervisor", "Dispatch Desk"][i % 3],
      fromStage: i > 0 ? flow[i - 1] : undefined,
      toStage: s,
    });
  }
  return hist.reverse(); // newest first
}

function enrich(o: Order): Order {
  const stage = o.trackingStage ?? STATUS_TO_STAGE[o.status];
  const box = o.lineItems[0]?.config.boxType ?? "Mailer Box";
  const gstRate = 0.18;
  const subtotal = Math.round(o.total / (1 + gstRate));
  const gst = o.total - subtotal;
  return {
    ...o,
    trackingStage: stage,
    paymentStatus: o.paymentStatus ?? paymentStatusFor(o),
    productionStatus: o.productionStatus ?? productionStatusFor(stage),
    productImage: o.productImage ?? IMAGE_BY_BOX[box] ?? "📦",
    productName: o.productName ?? o.lineItems[0]?.productName ?? box,
    trackingNumber: o.trackingNumber ?? o.shipment?.awb,
    expectedDelivery: o.expectedDelivery ?? o.dueAt,
    summary:
      o.summary ?? {
        subtotal,
        discount: 0,
        ecoPoints: Math.round(o.total / 100), // 1 eco point per ₹100
        shipping: o.type === "ready_made" ? 0 : Math.round(o.total * 0.02),
        gst,
      },
    history: o.history ?? buildHistory({ ...o, trackingStage: stage }, stage),
  };
}

let store: Order[] = seed.map(enrich);

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// ---------- Read hooks ----------

export function useOrders(): Order[] {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function useOrder(id: string | undefined): Order | undefined {
  const all = useOrders();
  return all.find((o) => o.id === id);
}

export function getOrder(id: string): Order | undefined {
  return store.find((o) => o.id === id);
}

/** Next sequential order id, e.g. ORD-2431. */
export function nextOrderId(): string {
  const nums = store
    .map((o) => Number(o.id.replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 2400) + 1;
  return `ORD-${next}`;
}

// ---------- Mutators ----------

/** Prepend a fully-formed order (e.g. created from a buyer cart at checkout). */
export function addOrder(order: Order): Order {
  const enriched = enrich(order);
  store = [enriched, ...store];
  emit();
  return enriched;
}

/**
 * Move an order to a new tracking stage, recording a history entry.
 * Keeps the coarse `status` in sync so existing consumers stay correct.
 */
export function updateOrderStage(
  id: string,
  toStage: OrderTrackingStage,
  opts: { note?: string; by?: string; notifyCustomer?: boolean } = {},
) {
  store = store.map((o) => {
    if (o.id !== id) return o;
    const fromStage = o.trackingStage;
    const entry: OrderHistoryEntry = {
      id: `${o.id}-h${Date.now()}`,
      at: new Date().toISOString(),
      action:
        toStage === "cancelled"
          ? "Order cancelled"
          : `Status updated to ${toStage.replace(/_/g, " ")}`,
      by: opts.by ?? "Bhupendra Mishra",
      fromStage,
      toStage,
      note: opts.notifyCustomer ? `${opts.note ?? ""} (customer notified)`.trim() : opts.note,
    };
    return {
      ...o,
      trackingStage: toStage,
      status: toOrderStatus(toStage),
      productionStatus: productionStatusFor(toStage),
      history: [entry, ...(o.history ?? [])],
    };
  });
  emit();
}
