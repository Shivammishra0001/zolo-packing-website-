// ============================================================
// Extended data source (formerly extended mock data).
//
// All demo/seed records removed permanently. Exports are EMPTY and typed. The
// app reads real data via stores/services and shows empty states when there's
// none. No fake catalog, finance, shipping, marketing or audit data.
// ============================================================

import type {
  ArtworkJob,
  AuditEvent,
  CatalogProduct,
  Category,
  Coupon,
  Invoice,
  Machine,
  PackagingTemplate,
  Payment,
  PurchaseOrder,
  Shipment,
  StockMovement,
  Supplier,
} from "./types";

export const categories: Category[] = [];

export const catalogProducts: CatalogProduct[] = [];

export const packagingTemplates: PackagingTemplate[] = [];

export const artworkJobs: ArtworkJob[] = [];

export const suppliers: Supplier[] = [];

export const purchaseOrders: PurchaseOrder[] = [];

export const shipments: Shipment[] = [];

export const invoices: Invoice[] = [];

export const payments: Payment[] = [];

export const stockMovements: StockMovement[] = [];

export const machines: Machine[] = [];

export const coupons: Coupon[] = [];

export const auditEvents: AuditEvent[] = [];

export const topProducts: { name: string; units: number; revenue: number }[] = [];

export const salesSeries: { day: string; revenue: number }[] = [];
