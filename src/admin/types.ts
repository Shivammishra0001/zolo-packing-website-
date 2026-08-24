// ---------- Entity types for the Zolo Packaging admin dashboard ----------
// Mock data lives in ./mock-data.ts and can be swapped for real API calls
// that resolve to these same shapes.

export type OrderStatus =
  | "confirmed"
  | "artwork_pending"
  | "proof_approved"
  | "in_production"
  | "qc"
  | "packed"
  | "dispatched"
  | "delivered";

export type OrderType = "ready_made" | "custom";

export type CustomerSegment = "small_seller" | "d2c_brand" | "enterprise";

export interface Customer {
  id: string;
  name: string;
  company: string;
  segment: CustomerSegment;
  email: string;
  phone: string;
  city: string;
  gstin?: string;
  totalOrders: number;
  lifetimeValue: number;
}

export interface OrderLineItem {
  id: string;
  productName: string;
  /** Frozen configuration at time of order */
  config: {
    boxType: string;
    dimensions: string;
    material: string;
    gsm: number;
    printing: string;
    finishes: string[];
  };
  quantity: number;
  unitPrice: number;
}

export interface ArtworkVersion {
  version: number;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  status: "pending" | "changes_requested" | "approved";
  approvedAt?: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  user: string;
  description: string;
  status?: OrderStatus;
}

// ---------- Order tracking (manufacturing lifecycle) ----------
// Fine-grained manufacturing stages, distinct from the coarse OrderStatus above
// (which stays as-is for existing consumers). A custom order may traverse all
// stages; a ready-stock order uses a shorter subset.
export type OrderTrackingStage =
  | "order_received"
  | "payment_confirmed"
  | "artwork_review"
  | "artwork_approved"
  | "material_allocated"
  | "production"
  | "printing"
  | "finishing"
  | "die_cutting"
  | "qc"
  | "packing"
  | "ready_for_dispatch"
  | "dispatched"
  | "in_transit"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "pending" | "partial" | "paid" | "refunded";

export type ProductionStatus = "not_started" | "in_progress" | "completed" | "on_hold";

/** A single row in an order's activity/audit history. */
export interface OrderHistoryEntry {
  id: string;
  at: string;
  action: string;
  by: string;
  fromStage?: OrderTrackingStage;
  toStage?: OrderTrackingStage;
  note?: string;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  type: OrderType;
  status: OrderStatus;
  placedAt: string;
  dueAt: string;
  total: number;
  amountPaid: number;
  lineItems: OrderLineItem[];
  artwork: ArtworkVersion[];
  shipment?: {
    courier: string;
    awb?: string;
    cartons: number;
  };
  activity: ActivityEvent[];

  // ---- Fields added for the ERP order-management redesign (all optional) ----
  /** Fine-grained manufacturing stage; drives the tracking bar. */
  trackingStage?: OrderTrackingStage;
  paymentStatus?: PaymentStatus;
  productionStatus?: ProductionStatus;
  productImage?: string; // emoji placeholder thumbnail
  productName?: string;  // headline product for the list row
  phone?: string;
  trackingNumber?: string;
  expectedDelivery?: string;
  /** Timestamps reached per stage, for the tracking bar. */
  stageTimestamps?: Partial<Record<OrderTrackingStage, string>>;
  /** Money breakdown for the order summary. */
  summary?: {
    subtotal: number;
    discount: number;
    ecoPoints: number;
    shipping: number;
    gst: number;
  };
  history?: OrderHistoryEntry[];
}

export interface Rfq {
  id: string;
  customerId: string;
  customerName: string;
  segment: CustomerSegment;
  boxType: string;
  dimensions: string;
  material: string;
  gsm: number;
  printing: string;
  finishes: string[];
  quantity: number;
  artworkFile?: string;
  submittedAt: string;
  /** 4 business hours from submission */
  slaDueAt: string;
  status: "pending" | "quoted" | "won" | "lost";
}

export type JobStage =
  | "printing"
  | "lamination"
  | "die_cutting"
  | "pasting"
  | "qc";

export interface JobCard {
  id: string;
  orderId: string;
  customerName: string;
  product: string;
  stage: JobStage;
  machine: string;
  plannedQty: number;
  goodQty: number;
  wasteQty: number;
  dispatchDueAt: string;
  delayed: boolean;
  startedAt?: string;
}

export type DispatchStatus = "awb_booked" | "packing" | "awaiting_courier";

export interface Dispatch {
  id: string;
  orderId: string;
  customerName: string;
  cartons: number;
  status: DispatchStatus;
  courier: string;
  awb?: string;
  dueAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  inStock: number;
  reorderLevel: number;
  /** Average units consumed per day, used to compute days-of-cover */
  dailyConsumption: number;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  href: string;
}

export interface KpiSnapshot {
  revenueToday: number;
  revenueYesterday: number;
  ordersToday: { readyMade: number; custom: number };
}

// ============================================================
// Extended ERP entities (added for the full admin build)
// ============================================================

// ---------- Product catalog ----------

/** Lifecycle state of the product record — independent of stock. */
export type ProductStatus = "active" | "draft" | "archived";

/**
 * Availability of the product — independent of ProductStatus.
 * A product can be Active + Out of Stock, Archived + In Stock, etc.
 * Never conflate "out of stock" with "archived".
 */
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

/** Reasons captured when an admin adjusts stock (audit-friendly). */
export type StockChangeReason =
  | "new_stock"
  | "manual_adjustment"
  | "damaged"
  | "returned"
  | "correction"
  | "other";

export interface ProductVariant {
  id: string;
  label: string;
  sku: string;
  moq: number;
  basePrice: number;
  inStock: number;
}

export interface ProductDimensions {
  length: number;
  width: number;
  height: number;
  unit: "in" | "cm" | "mm";
}

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  category: string;
  subcategory: string;
  status: ProductStatus;
  basePrice: number;
  moq: number;
  variants: ProductVariant[];
  /** Emoji stand-in used as the primary thumbnail (no real image backend yet). */
  imageEmoji: string;
  updatedAt: string;
  /** URL slug for the buyer website (derived from name when absent). */
  slug?: string;

  // ---- Fields added for the compact catalog management screen ----
  // All optional so existing consumers (e.g. ProductDetail) stay valid.
  /** Ordered image gallery. First entry is the primary image. Emoji placeholders. */
  images?: string[];
  dimensions?: ProductDimensions;
  gsm?: number;
  color?: string;
  /** On-hand stock at the product level (sum of variants when variants exist). */
  stock?: number;
  /** Threshold below which stock is considered "low". */
  lowStockLevel?: number;
  /** Derived availability; kept explicit so "mark out of stock" can pin it. */
  stockStatus?: StockStatus;
  description?: string;
}

export interface Category {
  id: string;
  name: string;
  subcategories: string[];
  productCount: number;
}

// ---------- Packaging templates ----------
export interface PackagingTemplate {
  id: string;
  name: string;
  type: string;
  dielineFile: string;
  usageCount: number;
  updatedAt: string;
}

// ---------- Artwork ----------
export type ArtworkStatus = "pending" | "changes_requested" | "approved" | "rejected" | "released";

export interface ArtworkJob {
  id: string;
  orderId: string;
  customerName: string;
  product: string;
  status: ArtworkStatus;
  currentVersion: number;
  versions: {
    version: number;
    fileName: string;
    uploadedBy: string;
    uploadedAt: string;
    note?: string;
    status: ArtworkStatus;
  }[];
  updatedAt: string;
}

// ---------- Procurement ----------
export interface Supplier {
  id: string;
  name: string;
  category: string;
  contact: string;
  phone: string;
  city: string;
  gstin: string;
  rating: number;
  activePOs: number;
}

export type PurchaseOrderStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  material: string;
  quantity: number;
  unit: string;
  amount: number;
  status: PurchaseOrderStatus;
  raisedAt: string;
  expectedAt: string;
}

// ---------- Shipping ----------
export type ShipmentStatus =
  | "packing"
  | "awb_booked"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered";

export interface Shipment {
  id: string;
  orderId: string;
  customerName: string;
  courier: string;
  awb?: string;
  cartons: number;
  weightKg: number;
  destination: string;
  status: ShipmentStatus;
  bookedAt: string;
  eta: string;
}

// ---------- Finance ----------
export type InvoiceStatus = "draft" | "sent" | "paid" | "partial" | "overdue";

export interface Invoice {
  id: string;
  orderId: string;
  customerName: string;
  amount: number;
  tax: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAmount: number;
}

export type PaymentMethod = "upi" | "neft" | "card" | "cheque" | "cash";

export interface Payment {
  id: string;
  invoiceId: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  at: string;
}

// ---------- Inventory movement ----------
export type MovementType = "inward" | "outward" | "adjustment";

export interface StockMovement {
  id: string;
  itemName: string;
  type: MovementType;
  quantity: number;
  unit: string;
  reference: string;
  at: string;
  by: string;
}

// ---------- Audit / activity ----------
export interface AuditEvent {
  id: string;
  user: string;
  action: string;
  module: string;
  entity: string;
  at: string;
}

// ---------- Machines (production) ----------
export type MachineState = "running" | "idle" | "maintenance" | "down";

export interface Machine {
  id: string;
  name: string;
  type: string;
  state: MachineState;
  currentJob?: string;
  utilizationPct: number;
}

// ---------- Marketing ----------
export type CouponStatus = "active" | "scheduled" | "expired";

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discount: string;
  status: CouponStatus;
  used: number;
  limit: number;
  expiresAt: string;
}
