import { useMemo } from "react";
import { useAuthSession } from "@/components/auth/AuthContext";
import { customers, rfqs } from "@/admin/mock-data";
import { useOrders } from "@/admin/orders-store";
import { invoices, payments, shipments } from "@/admin/mock-data-ext";
import type { AuthUser, Customer, Invoice, Order, Payment, Rfq, Shipment } from "./types";

// ============================================================
// Buyer data layer — SCOPES all data to the logged-in customer only.
//
// STRICT DATA SEPARATION: every selector here filters by the authenticated
// buyer's customerId / company. A buyer can never see another customer's data.
//
// This reuses the same mock stores the admin uses (single source of truth), but
// only ever returns the slice belonging to THIS customer.
//
// TODO(backend): replace these client-side filters with server endpoints that
// enforce ownership server-side (e.g. GET /api/me/orders). The frontend filter
// is a convenience, NOT a security boundary.
// ============================================================

/** Resolve the customer record for the logged-in buyer (dev fallback: CUST-003). */
function resolveCustomer(user: AuthUser | null): Customer | undefined {
  const id = user?.customerId ?? "CUST-003";
  return customers.find((c) => c.id === id);
}

export function useBuyerCustomer(): Customer | undefined {
  const { user } = useAuthSession();
  return useMemo(() => resolveCustomer(user), [user]);
}

/** All fields the buyer UI needs about themselves. */
export function useBuyerProfile() {
  const { user } = useAuthSession();
  const customer = useBuyerCustomer();
  return useMemo(
    () => ({
      firstName: user?.firstName ?? customer?.name?.split(" ")[0] ?? "there",
      lastName: user?.lastName ?? customer?.name?.split(" ").slice(1).join(" ") ?? "",
      name: customer?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ") ?? "Customer",
      email: user?.email ?? customer?.email ?? "",
      phone: user?.phone ?? customer?.phone ?? "",
      state: user?.state ?? "",
      company: user?.company ?? customer?.company ?? "",
      gstin: user?.gstin ?? customer?.gstin ?? "",
      city: customer?.city ?? "",
    }),
    [user, customer],
  );
}

/** This buyer's orders only. Reactive (reflects admin status updates). */
export function useBuyerOrders(): Order[] {
  const all = useOrders();
  const customer = useBuyerCustomer();
  return useMemo(() => {
    if (!customer) return [];
    return all.filter((o) => o.customerId === customer.id);
  }, [all, customer]);
}

export function useBuyerOrder(id: string | undefined): Order | undefined {
  const orders = useBuyerOrders();
  return useMemo(() => orders.find((o) => o.id === id), [orders, id]);
}

/** This buyer's quotations only. */
export function useBuyerQuotations(): Rfq[] {
  const customer = useBuyerCustomer();
  return useMemo(() => (customer ? rfqs.filter((r) => r.customerId === customer.id) : []), [customer]);
}

/** Invoices belonging to this buyer (linked by company name in mock data). */
export function useBuyerInvoices(): Invoice[] {
  const customer = useBuyerCustomer();
  return useMemo(
    () => (customer ? invoices.filter((i) => i.customerName === customer.company) : []),
    [customer],
  );
}

/** Payment records for this buyer. */
export function useBuyerPayments(): Payment[] {
  const customer = useBuyerCustomer();
  return useMemo(
    () => (customer ? payments.filter((p) => p.customerName === customer.company) : []),
    [customer],
  );
}

/** Shipments for this buyer's orders. */
export function useBuyerShipments(): Shipment[] {
  const customer = useBuyerCustomer();
  return useMemo(
    () => (customer ? shipments.filter((s) => s.customerName === customer.company) : []),
    [customer],
  );
}

export function useBuyerShipmentForOrder(orderId: string | undefined): Shipment | undefined {
  const ship = useBuyerShipments();
  return useMemo(() => ship.find((s) => s.orderId === orderId), [ship, orderId]);
}

// ---------- Recycle / eco pickups (buyer-only mock) ----------

export interface RecycleEntry {
  id: string;
  orderId: string;
  date: string;
  weightKg: number;
  orderAmount: number;
  status: "pickup" | "coupon" | "processing";
}

/** Recycle pickups for this buyer, derived from their delivered orders. */
export function useBuyerRecycle(): RecycleEntry[] {
  const orders = useBuyerOrders();
  return useMemo(() => {
    const delivered = orders.filter((o) => o.trackingStage === "delivered" || o.status === "delivered");
    const statuses: RecycleEntry["status"][] = ["coupon", "processing", "pickup"];
    return delivered.slice(0, 6).map((o, i) => ({
      id: `REC-${5100 + i}`,
      orderId: o.id,
      date: o.dueAt,
      weightKg: Math.max(2, Math.round((o.lineItems.reduce((s, li) => s + li.quantity, 0) / 500) * 1.5)),
      orderAmount: o.total,
      status: statuses[i % statuses.length],
    }));
  }, [orders]);
}
