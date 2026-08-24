import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/lib/api/client";

// ============================================================
// Admin dashboard data — every figure comes from PostgreSQL via
// GET /api/v1/admin/*. Replaces the empty mock arrays that made the dashboard
// report zeros regardless of what was actually in the database.
// ============================================================

export interface AdminDashboard {
  orders: { total: number; today: number; pending: number; confirmed: number; processing: number; packed: number; shipped: number; delivered: number; cancelled: number };
  payments: { pending: number; paid: number; failed: number; refunded: number };
  revenue: { totalMinor: number; todayMinor: number; monthMinor: number };
  customers: { total: number; newToday: number };
  products: { total: number; lowStock: number; outOfStock: number };
  recentOrders: {
    id: string; orderNumber: string; status: string; paymentStatus: string;
    grandTotalMinor: number; itemCount: number; createdAt: string;
    customer: { id: string; name: string; email: string } | null;
  }[];
  recentActivity: ActivityEntry[];
  lowStockProducts: { id: string; sku: string; name: string; available: number; threshold: number | null; image: string | null }[];
  generatedAt: string;
}

export interface ActivityEntry {
  id: string; eventType: string; entityType: string | null; entityId: string | null;
  actor: string; actorRole: string | null; title: string; body: string; createdAt: string;
}

/** Four explicit states — the UI must never render zeros while loading. */
export type QueryState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: string };

/**
 * Fetch + poll an admin endpoint.
 *
 * `pollMs` keeps the dashboard current without a manual refresh — polling is
 * used deliberately rather than adding WebSocket infrastructure for a
 * single-operator admin panel. Polling pauses while the tab is hidden.
 */
export function useAdminQuery<T>(path: string, pollMs = 20_000): QueryState<T> & { refetch: () => void } {
  const [state, setState] = useState<QueryState<T>>({ status: "loading", data: null, error: null });
  const mounted = useRef(true);

  const load = useCallback(async (background = false) => {
    // An empty path means "nothing selected yet" (e.g. no customer id) — stay
    // in loading rather than requesting the API root.
    if (!path) return;
    if (!background) setState({ status: "loading", data: null, error: null });
    try {
      const data = await request<T>(path);
      if (mounted.current) setState({ status: "success", data, error: null });
    } catch (e) {
      // A failed refresh must surface, not silently leave stale numbers on screen.
      if (mounted.current) {
        setState({ status: "error", data: null, error: e instanceof Error ? e.message : "Could not load dashboard data." });
      }
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    void load();
    if (pollMs <= 0) return () => { mounted.current = false; };

    const tick = () => { if (document.visibilityState === "visible") void load(true); };
    const id = window.setInterval(tick, pollMs);
    // Catch up immediately when the operator returns to the tab.
    document.addEventListener("visibilitychange", tick);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, pollMs]);

  return { ...state, refetch: () => void load() };
}

export const useAdminDashboard = (pollMs = 20_000) => useAdminQuery<AdminDashboard>("/admin/dashboard", pollMs);
export const useAdminActivity = (limit = 30) => useAdminQuery<{ activity: ActivityEntry[]; nextCursor: string | null }>(`/admin/activity?limit=${limit}`);
export const useAdminAnalytics = (days = 30) =>
  useAdminQuery<{ days: number; series: { day: string; orders: number; revenueMinor: number }[]; topProducts: { productId: string; name: string; sku: string; units: number; revenueMinor: number }[] }>(`/admin/analytics?days=${days}`, 60_000);
export const useAdminInventory = (lowOnly = false) =>
  useAdminQuery<{ inventory: { id: string; sku: string; name: string; category: string; stock: number; reserved: number; available: number; threshold: number | null; state: string; image: string | null }[]; total: number; valuation: { stockValueMinor: number; pricedProducts: number; totalProducts: number } }>(`/admin/inventory?limit=100${lowOnly ? "&lowOnly=1" : ""}`);

export interface StockMovementRow {
  id: string; type: string; quantity: number; balance: number;
  reason: string | null; refType: string | null; refId: string | null;
  createdAt: string; productId: string; sku: string | null;
  productName: string | null; emoji: string | null; actor: string;
}

/** Inventory ledger — every stock change, newest first. */
export const useAdminStockMovements = (productId: string | null = null, limit = 100) =>
  useAdminQuery<{ movements: StockMovementRow[]; total: number }>(
    `/admin/inventory/movements?limit=${limit}${productId ? `&productId=${productId}` : ""}`,
  );

// ---- Module data ----------------------------------------------------------

export type CustomerSegmentKey = "small_seller" | "d2c_brand" | "enterprise";

export interface AdminCustomer {
  id: string; name: string; email: string; phone: string | null;
  /** Null when the buyer isn't attached to an organisation — never a placeholder. */
  company: string | null;
  city: string | null; state: string | null;
  isActive: boolean; totalOrders: number; lifetimeValueMinor: number;
  lastOrderAt: string | null; createdAt: string; lastLoginAt: string | null;
  segment: CustomerSegmentKey;
}

export interface AdminCustomerAddress {
  id: string; kind: string; name: string; phone: string | null;
  line1: string; line2: string | null; city: string; state: string;
  postalCode: string; country: string; isDefault: boolean;
}

export interface AdminCustomerOrder {
  id: string; orderNumber: string; status: string; paymentStatus: string;
  grandTotalMinor: number; paidMinor: number; itemCount: number; createdAt: string;
}

export interface AdminCustomerPayment {
  id: string; paymentNumber: string; method: string | null; amountMinor: number;
  status: string; reference: string | null; paidAt: string | null; createdAt: string;
  orderId: string | null; orderNumber: string | null; refundedMinor: number;
}

export interface AdminCustomerDetail extends AdminCustomer {
  firstName: string; lastName: string | null;
  cancelledOrders: number; addressCount: number;
  averageOrderMinor: number;
}

export const useAdminCustomers = (search = "", limit = 100) =>
  useAdminQuery<{ customers: AdminCustomer[]; total: number }>(
    `/admin/customers?limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
  );

export const useAdminCustomer = (id: string | null) =>
  useAdminQuery<{
    customer: AdminCustomerDetail;
    totals: { paidMinor: number; refundedMinor: number; outstandingMinor: number };
    orders: AdminCustomerOrder[];
    payments: AdminCustomerPayment[];
    addresses: AdminCustomerAddress[];
  }>(id ? `/admin/customers/${id}` : "", id ? 30_000 : 0);

export const useAdminFinance = () =>
  useAdminQuery<{
    summary: { capturedMinor: number; pendingMinor: number; refundedMinor: number; failedCount: number; receivableMinor: number; receivableOrders: number };
    invoices: { id: string; number: string; status: string; totalMinor: number; createdAt: string; orderNumber: string | null; customer: string | null }[];
    payments: { id: string; status: string; amountMinor: number; method: string | null; reference: string | null; paidAt: string | null; createdAt: string; orderNumber: string | null }[];
  }>("/admin/finance?limit=50");

export const useAdminShipping = () =>
  useAdminQuery<{
    shipments: { id: string; shipmentNumber: string; carrier: string | null; trackingNumber: string | null; status: string; shippedAt: string | null; deliveredAt: string | null; createdAt: string; orderNumber: string | null; lastEvent: { status: string; at: string } | null }[];
    total: number; pendingDispatch: number;
  }>("/admin/shipping");

export const useAdminMarketing = () =>
  useAdminQuery<{
    coupons: { id: string; code: string; discountType: string; discountValue: number; minOrderMinor: number | null; maxDiscountMinor: number | null; usageLimit: number | null; usedCount: number; validFrom: string | null; validUntil: string | null; isActive: boolean; redemptions: number; state: string }[];
    total: number;
  }>("/admin/marketing");

/**
 * Adapt a QueryState to the `MockQuery` shape ({data, loading, error, retry})
 * that existing admin panels already handle. Lets a page switch to real data
 * without rewriting its loading/error/empty JSX.
 */
export function asMockQuery<T>(q: QueryState<T> & { refetch: () => void }): {
  data: T | null; loading: boolean; error: string | null; retry: () => void;
} {
  return { data: q.data, loading: q.status === "loading", error: q.error, retry: q.refetch };
}
