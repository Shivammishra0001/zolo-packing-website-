// Buyer module type barrel — re-exports the shared admin entity types so buyer
// pages import from one place. The buyer never gets admin-only shapes.
export type {
  Customer,
  Order,
  OrderLineItem,
  Rfq,
  Invoice,
  Payment,
  Shipment,
  OrderTrackingStage,
  PaymentStatus,
} from "@/admin/types";
export type { AuthUser } from "@/lib/auth/types";
