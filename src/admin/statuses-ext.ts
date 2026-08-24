// ---------- Status → Badge tone mappings for extended ERP entities ----------
// Uses the tone vocabulary from components/ui.tsx (Badge). Single source of
// truth for these modules, mirroring statuses.ts for the core entities.

import type {
  ArtworkStatus,
  CouponStatus,
  InvoiceStatus,
  MachineState,
  ProductStatus,
  PurchaseOrderStatus,
  ShipmentStatus,
  StockStatus,
} from "./types";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
interface Meta {
  label: string;
  tone: Tone;
}

export const PRODUCT_STATUS: Record<ProductStatus, Meta> = {
  active: { label: "Active", tone: "success" },
  draft: { label: "Draft", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

/** Stock availability — independent of PRODUCT_STATUS. */
export const STOCK_STATUS: Record<StockStatus, Meta> = {
  in_stock: { label: "In Stock", tone: "success" },
  low_stock: { label: "Low Stock", tone: "warning" },
  out_of_stock: { label: "Out of Stock", tone: "danger" },
};

/** Derive stock status from a quantity + threshold (0 ⇒ out of stock). */
export function deriveStockStatus(stock: number, lowLevel: number): StockStatus {
  if (stock <= 0) return "out_of_stock";
  if (stock <= lowLevel) return "low_stock";
  return "in_stock";
}

export const ARTWORK_STATUS: Record<ArtworkStatus, Meta> = {
  pending: { label: "Pending Review", tone: "warning" },
  changes_requested: { label: "Changes Requested", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  released: { label: "Released to Production", tone: "primary" },
};

export const PO_STATUS: Record<PurchaseOrderStatus, Meta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  partial: { label: "Partially Received", tone: "warning" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const SHIPMENT_STATUS: Record<ShipmentStatus, Meta> = {
  packing: { label: "Packing", tone: "warning" },
  awb_booked: { label: "AWB Booked", tone: "info" },
  picked_up: { label: "Picked Up", tone: "info" },
  in_transit: { label: "In Transit", tone: "primary" },
  out_for_delivery: { label: "Out for Delivery", tone: "primary" },
  delivered: { label: "Delivered", tone: "success" },
};

export const INVOICE_STATUS: Record<InvoiceStatus, Meta> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  partial: { label: "Partially Paid", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
};

export const MACHINE_STATE: Record<MachineState, Meta> = {
  running: { label: "Running", tone: "success" },
  idle: { label: "Idle", tone: "neutral" },
  maintenance: { label: "Maintenance", tone: "warning" },
  down: { label: "Down", tone: "danger" },
};

export const COUPON_STATUS: Record<CouponStatus, Meta> = {
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
};
