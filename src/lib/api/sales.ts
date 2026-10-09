// Field-sales API. Uses the shared authenticated client, so the rep's JWT is
// sent automatically; the backend scopes every query to that user.
import { request } from "./client";

export interface SalesProfile {
  id: string;
  userId: string;
  employeeId: string;
  territory: string | null;
  branch: string | null;
  status: "ACTIVE" | "SUSPENDED" | "LEFT";
}

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  email: string;
}

export interface RecentItem {
  orderNumber: string;
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  specs: Record<string, unknown>;
  orderedAt: string;
}

export interface CustomerSnapshot {
  customer: CustomerHit;
  orderCount: number;
  lastOrderMinor: number;
  totalBusinessMinor: number;
  outstandingMinor: number;
  recentItems: RecentItem[];
  recentOrders: {
    id: string;
    orderNumber: string;
    grandTotalMinor: number;
    paidMinor: number;
    status: string;
    paymentStatus: string;
    placedAt: string;
  }[];
}

/**
 * One captured line. A catalog line carries productId; a bespoke packaging job
 * carries itemName instead. The backend requires an explicit unit price on
 * both — B2B pricing is negotiated, so it never silently uses list price.
 */
export interface CaptureItem {
  productId?: string;
  itemName?: string;
  quantity: number;
  unitPriceMinor: number;
  specs?: Record<string, unknown>;
}

export interface CaptureOrderInput {
  customerId: string;
  items: CaptureItem[];
  notes?: string;
  shippingMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
}

export interface SalesOrderRow {
  id: string;
  orderNumber: string;
  customer: string;
  grandTotalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  status: string;
  paymentStatus: string;
  itemCount: number;
  placedAt: string;
}

export interface SalesKpis {
  orders: number;
  salesMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  averageOrderMinor: number;
  collectionRateBps: number;
  newCustomers: number;
  repeatCustomers: number;
  cancelled: number;
}

export const salesApi = {
  me: () => request<SalesProfile>("/sales/me"),

  searchCustomers: (q: string) =>
    request<{ customers: CustomerHit[] }>(`/sales/customers/search?q=${encodeURIComponent(q)}`),

  createCustomer: (input: {
    name: string; email: string; phone: string;
    company?: string; gstin?: string; address?: Record<string, string>;
  }) => request<{ id: string }>("/sales/customers", { method: "POST", body: input }),

  snapshot: (customerId: string) => request<CustomerSnapshot>(`/sales/customers/${customerId}/snapshot`),

  createOrder: (input: CaptureOrderInput) =>
    request<{ id: string; orderNumber: string; grandTotalMinor: number }>("/sales/orders", {
      method: "POST",
      body: input,
    }),

  listOrders: (params: { from?: string; to?: string; paymentStatus?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<{ orders: SalesOrderRow[] }>(`/sales/orders${s ? `?${s}` : ""}`);
  },

  getOrder: (id: string) => request<Record<string, unknown>>(`/sales/orders/${id}`),

  /** Attach a customer sample. Base64 so the phone camera can post directly. */
  addSample: (orderId: string, input: { fileName: string; mime: string; dataBase64: string; caption?: string }) =>
    request<{ id: string; fileName: string }>(`/sales/orders/${orderId}/samples`, { method: "POST", body: input }),

  kpis: (params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<SalesKpis>(`/sales/kpis${s ? `?${s}` : ""}`);
  },
};

export interface SalespersonRow extends SalesProfile {
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  joinedAt: string | null;
}

export interface PerformanceRow extends SalesKpis {
  salespersonId: string;
  employeeId: string;
  name: string;
  territory: string | null;
  status: string;
}

export const adminSalesApi = {
  list: (status?: string) =>
    request<{ salespeople: SalespersonRow[] }>(`/admin/sales/salespeople${status ? `?status=${status}` : ""}`),

  create: (input: {
    name: string; email: string; password: string; employeeId: string;
    phone?: string; territory?: string; branch?: string;
  }) => request<SalespersonRow>("/admin/sales/salespeople", { method: "POST", body: input }),

  setStatus: (id: string, status: "ACTIVE" | "SUSPENDED" | "LEFT") =>
    request<SalesProfile>(`/admin/sales/salespeople/${id}/status`, { method: "PATCH", body: { status } }),

  performance: (params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<{ rows: PerformanceRow[] }>(`/admin/sales/performance${s ? `?${s}` : ""}`);
  },
};

// ---------------------------------------------------------------------------
// Salesperson detail (admin drill-down behind a leaderboard row)
// ---------------------------------------------------------------------------

export interface SalespersonOrderRow {
  id: string;
  orderNumber: string;
  placedAt: string;
  customerId: string | null;
  customer: string;
  products: string;
  itemCount: number;
  saleMinor: number;
  receivedMinor: number;
  balanceMinor: number;
  /** null when no line on the order carries a cost snapshot. */
  profitMinor: number | null;
  deliveryDate: string | null;
  delivered: boolean;
  status: string;
  paymentStatus: string;
}

export interface SalespersonDetail {
  salesperson: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
    employeeId: string;
    territory: string | null;
    branch: string | null;
    status: string;
    joinedAt: string | null;
    hasProfile: boolean;
  };
  kpis: SalesKpis & {
    costMinor: number;
    profitMinor: number;
    costedLines: number;
    totalLines: number;
    costCoverageBps: number;
    /** Customers whose ACCOUNT this rep owns — not derived from orders. */
    ownedCustomers: number;
    /** Money this person physically received, which may differ from orders. */
    collectedByThemMinor: number;
  };
  ordersByStatus: Record<string, number>;
  monthly: { month: string; orders: number; salesMinor: number; collectedMinor: number }[];
  orders: SalespersonOrderRow[];
  customers: { id: string; name: string; phone: string | null; isActive: boolean; createdAt: string }[];
  collections: {
    id: string;
    paymentNumber: string;
    amountMinor: number;
    method: string;
    kind: string;
    paidAt: string | null;
    orderId: string | null;
    orderNumber: string | null;
    customer: string;
  }[];
}

export const salespersonDetailApi = {
  get: (id: string, params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<SalespersonDetail>(`/admin/sales/salespeople/${id}/detail${s ? `?${s}` : ""}`);
  },
};
