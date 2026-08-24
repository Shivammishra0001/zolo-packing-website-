// Admin orders API — uses the storefront authenticated client, which sends the
// admin's JWT (zolo.store.accessToken). The backend gates every /admin route
// with requireAdmin, so a non-admin token is rejected server-side.
import { request } from "./client";
import type { Order } from "./commerce";

export interface OrderStats {
  totalOrders: number;
  revenueMinor: number;
  pendingPayment: number;
  paid: number;
  processing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  pending: number;
  confirmed: number;
}

export interface AdminOrderList { total: number; page: number; pageSize: number; orders: Order[] }

export interface AdminOrderFilters {
  status?: string;
  paymentStatus?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface StatusUpdateInput {
  status: string;
  note?: string;
  courier?: string;
  trackingNumber?: string;
}

function qs(filters: AdminOrderFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const adminOrdersApi = {
  stats: () => request<OrderStats>("/admin/orders/stats"),
  list: (filters: AdminOrderFilters = {}) => request<AdminOrderList>(`/admin/orders${qs(filters)}`),
  get: (id: string) => request<Order>(`/admin/orders/${id}`),
  updateStatus: (id: string, input: StatusUpdateInput) =>
    request<Order>(`/admin/orders/${id}/status`, { method: "PATCH", body: input }),
  invoice: (id: string) => request<{ invoiceNumber: string; issuedAt: string; status: string; order: Order }>(`/admin/orders/${id}/invoice`),
};
