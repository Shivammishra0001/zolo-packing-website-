import type {
  CustomerSegment,
  DispatchStatus,
  JobStage,
  OrderStatus,
} from "./types";

// ---------- Single source of truth for status labels + colors ----------
// Every badge, pill, stepper and board in the admin reads from this file.

export interface StatusMeta {
  label: string;
  /** Tailwind classes for pill/badge rendering */
  badge: string;
  /** Solid dot color, for compact indicators */
  dot: string;
}

export const ORDER_STATUS: Record<OrderStatus, StatusMeta> = {
  confirmed: {
    label: "Confirmed",
    badge: "bg-dark-100 text-dark-700 border-dark-200",
    dot: "bg-dark-400",
  },
  artwork_pending: {
    label: "Artwork Pending",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  proof_approved: {
    label: "Proof Approved",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
  },
  in_production: {
    label: "In Production",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
  },
  qc: {
    label: "QC",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200",
    dot: "bg-cyan-500",
  },
  packed: {
    label: "Packed",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
  },
  dispatched: {
    label: "Dispatched",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  delivered: {
    label: "Delivered",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-600",
  },
};

/** Order lifecycle in stepper order */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "confirmed",
  "artwork_pending",
  "proof_approved",
  "in_production",
  "qc",
  "packed",
  "dispatched",
  "delivered",
];

export const JOB_STAGE: Record<JobStage, StatusMeta> = {
  printing: {
    label: "Printing",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
  },
  lamination: {
    label: "Lamination",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
  },
  die_cutting: {
    label: "Die Cutting",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  pasting: {
    label: "Pasting",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
  },
  qc: {
    label: "QC",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200",
    dot: "bg-cyan-500",
  },
};

/** Used when a job has missed / is at risk of missing its dispatch date */
export const DELAYED_META: StatusMeta = {
  label: "Delayed",
  badge: "bg-red-50 text-red-700 border-red-200",
  dot: "bg-red-500",
};

export const DISPATCH_STATUS: Record<DispatchStatus, StatusMeta> = {
  awb_booked: {
    label: "AWB Booked",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  packing: {
    label: "Packing",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  awaiting_courier: {
    label: "Awaiting Courier",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    dot: "bg-sky-500",
  },
};

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  small_seller: "Small Seller",
  d2c_brand: "D2C Brand",
  enterprise: "Enterprise",
};

// SLA thresholds for the RFQ 4-business-hour quote promise
export const SLA_AMBER_MS = 2 * 60 * 60 * 1000; // < 2h remaining
export const SLA_RED_MS = 1 * 60 * 60 * 1000; // < 1h remaining
