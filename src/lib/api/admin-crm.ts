// Admin CRM API — customers, admin-raised orders and the payment ledger.
//
// Backed by /api/v1/admin/crm/* (server/src/services/crm.mjs). Two rules from
// the backend shape everything here:
//
//   * Money is DERIVED. `paidMinor` / `pendingMinor` / `paymentStatus` are
//     computed by the server from the Payment + Refund rows; the client never
//     sends them and must never compute its own version for display.
//   * OVERDUE is a read-time state (pending > 0 and dueDate in the past), so
//     it arrives as `paymentStatus: "OVERDUE"` on list responses but is not a
//     stored enum value.
//
// See docs/CRM-AUDIT.md.
import { request } from "./client";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Payment position labels the SERVER derives. Never assembled client-side. */
export type CrmPaymentStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "PARTIAL"
  | "PENDING"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export type PaymentKind = "ADVANCE" | "PARTIAL" | "FINAL" | "ADJUSTMENT";
export type PaymentMethod = "cash" | "bank_transfer" | "upi" | "card" | "cheque" | "other";
export type CustomerFinancialStatus = "CLEAR" | "PENDING" | "OVERDUE";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export const PAYMENT_KINDS: { value: PaymentKind; label: string }[] = [
  { value: "ADVANCE", label: "Advance" },
  { value: "PARTIAL", label: "Part payment" },
  { value: "FINAL", label: "Final payment" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

export const ORDER_SOURCES = ["website", "admin", "whatsapp", "phone", "offline", "quote"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export interface CrmCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  customerType: string | null;
  gstin: string | null;
  isActive: boolean;
  createdAt: string;
  orderCount: number;
  orderValueMinor: number;
  paidMinor: number;
  pendingMinor: number;
  overdueMinor: number;
  lastOrderAt: string | null;
  financialStatus: CustomerFinancialStatus;
  /** The rep who owns this account, or null when unassigned. */
  salesperson: { id: string; name: string } | null;
}

export interface CrmOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  isCustomItem: boolean;
  description: string | null;
}

export interface CrmPayment {
  id: string;
  paymentNumber: string;
  amountMinor: number;
  method: string;
  kind: PaymentKind;
  status: string;
  reference: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CrmOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  grandTotalMinor: number;
  paidMinor: number;
  notes: string | null;
  source: string | null;
  dueDate: string | null;
  expectedDeliveryDate: string | null;
  placedAt: string;
  items: CrmOrderItem[];
  payments: CrmPayment[];
}

/** One row of the payments ledger, already joined to its order + customer. */
export interface CrmPaymentRow {
  id: string;
  paymentNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  amountMinor: number;
  refundedMinor: number;
  method: string;
  kind: PaymentKind;
  status: string;
  reference: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
  receivedBy: string | null;
}

export interface CrmOutstandingRow {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  grandTotalMinor: number;
  paidMinor: number;
  pendingMinor: number;
  paymentStatus: CrmPaymentStatus;
  dueDate: string | null;
  daysOverdue: number;
  placedAt: string;
  /** Delivery, reported independently of payment — the two are separate axes. */
  orderStatus: string;
  delivered: boolean;
  deliveredAt: string | null;
  expectedDeliveryDate: string | null;
}

export interface CrmPaymentSummary {
  orderCount: number;
  totalValueMinor: number;
  receivedMinor: number;
  pendingMinor: number;
  overdueMinor: number;
  collectedTodayMinor: number;
  collectedThisMonthMinor: number;
  partiallyPaidOrders: number;
  paidOrders: number;
}

export interface CrmNotificationRow {
  id: string;
  channel: string;
  messageType: string;
  recipient: string;
  subject: string | null;
  status: string;
  error: string | null;
  entityType: string | null;
  entityId: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** Per-channel dispatch outcome. SKIPPED carries the honest reason. */
export interface DispatchResult {
  event: string;
  inApp?: { status: string } | null;
  email?: { status: string; error?: string } | null;
  whatsapp?: { status: string; error?: string } | null;
  sms?: { status: string; error?: string } | null;
}

export type NotificationTemplate = "ORDER_CREATED" | "PAYMENT_RECEIVED" | "PAYMENT_DUE" | "PAYMENT_OVERDUE";

/** The pagination envelope every CRM list endpoint returns. */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}
export type CrmCustomerList = PageMeta & { customers: CrmCustomer[] };
export type CrmPaymentList = PageMeta & { payments: CrmPaymentRow[] };
export type CrmOutstandingList = PageMeta & { orders: CrmOutstandingRow[] };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CustomerInput {
  name: string;
  /** Optional: the API stores a non-deliverable placeholder when omitted. */
  email?: string;
  phone: string;
  company?: string;
  gstin?: string;
  alternatePhone?: string;
  customerType?: "individual" | "business";
  /** Account manager; "" clears the assignment. */
  salespersonId?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

/** One line on the order form: a catalog product OR a custom packaging item. */
export interface OrderItemInput {
  productId?: string | null;
  itemName?: string;
  sku?: string | null;
  description?: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxMinor?: number;
}

export interface OrderInput {
  customerId: string;
  items: OrderItemInput[];
  source?: OrderSource;
  notes?: string;
  dueDate?: string | null;
  expectedDeliveryDate?: string | null;
  discountMinor?: number;
  taxMinor?: number;
  shippingMinor?: number;
  paymentMethod?: string;
  /** Optional advance taken at the counter, recorded as a real Payment row. */
  advanceMinor?: number;
  advanceMethod?: PaymentMethod;
  advanceReference?: string;
  advanceNotes?: string;
}

export interface PaymentInput {
  amountMinor: number;
  method: PaymentMethod;
  kind?: PaymentKind;
  reference?: string;
  notes?: string;
  paidAt?: string;
  /** Only when the business genuinely accepts an overpayment. */
  allowOverpayment?: boolean;
}

export interface PaymentTotals {
  paidMinor: number;
  pendingMinor: number;
  paymentStatus: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== "all") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const adminCrmApi = {
  // ---- customers
  listCustomers: (params: {
    q?: string;
    page?: number;
    limit?: number;
    status?: string;
    customerType?: string;
    hasPending?: "1";
    hasOverdue?: "1";
  } = {}) => request<CrmCustomerList>(`/admin/crm/customers${qs(params)}`),

  createCustomer: (input: CustomerInput) =>
    request<{ customer: { id: string } }>("/admin/crm/customers", { method: "POST", body: input }),

  updateCustomer: (id: string, input: Partial<CustomerInput> & { isActive?: boolean }) =>
    request<{ customer: { id: string } }>(`/admin/crm/customers/${id}`, { method: "PATCH", body: input }),

  customerNotifications: (id: string, limit = 50) =>
    request<{ notifications: CrmNotificationRow[] }>(`/admin/crm/customers/${id}/notifications${qs({ limit })}`),

  // ---- orders
  createOrder: (input: OrderInput) =>
    request<{ order: CrmOrder }>("/admin/crm/orders", { method: "POST", body: input }),

  /** Append a payment. The response carries the SERVER's restated totals. */
  addPayment: (orderId: string, input: PaymentInput) =>
    request<{ payment: CrmPayment; order: CrmOrder; totals: PaymentTotals }>(
      `/admin/crm/orders/${orderId}/payments`,
      { method: "POST", body: input },
    ),

  notify: (orderId: string, template: NotificationTemplate) =>
    request<{ result: DispatchResult }>(`/admin/crm/orders/${orderId}/notify`, {
      method: "POST",
      body: { template },
    }),

  // ---- payments
  refund: (paymentId: string, input: { amountMinor: number; reason?: string; reference?: string }) =>
    request<{ refund: { id: string }; totals: PaymentTotals }>(`/admin/crm/payments/${paymentId}/refund`, {
      method: "POST",
      body: input,
    }),

  listPayments: (params: { q?: string; page?: number; limit?: number; status?: string; method?: string } = {}) =>
    request<CrmPaymentList>(`/admin/crm/payments${qs(params)}`),

  paymentSummary: () => request<CrmPaymentSummary>("/admin/crm/payments/summary"),

  // ---- dues
  outstanding: (
    params: {
      bucket?: "overdue" | "today" | "week" | "month" | "all";
      collection?: "pending" | "partial" | "paid" | "overdue";
      delivery?: "delivered" | "undelivered";
      q?: string;
      from?: string;
      to?: string;
      /** Include fully-paid orders; the default is unpaid only. */
      settled?: string;
      page?: number;
      limit?: number;
    } = {},
  ) => request<CrmOutstandingList>(`/admin/crm/outstanding${qs(params)}`),

  /** Settle the whole remaining balance; the amount is computed server-side. */
  markFullPayment: (orderId: string, body: { method?: string; reference?: string; notes?: string; paidAt?: string } = {}) =>
    request<{ payment: CrmPayment; totals: PaymentTotals; settledMinor: number }>(
      `/admin/crm/orders/${orderId}/payments/full`,
      { method: "POST", body },
    ),

  /** Write off an uncollectable balance. Requires a reason; records an ADJUSTMENT. */
  writeOffBalance: (orderId: string, body: { reason: string }) =>
    request<{ payment: CrmPayment; totals: PaymentTotals; writtenOffMinor: number }>(
      `/admin/crm/orders/${orderId}/payments/write-off`,
      { method: "POST", body },
    ),
};

// ---------------------------------------------------------------------------
// Sales & Financial Details report
// ---------------------------------------------------------------------------

export interface FinancialReportRow {
  customerId: string | null;
  customerName: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  productName: string;
  quantity: number;
  rateMinor: number;
  saleMinor: number;
  costMinor: number | null;
  receivedMinor: number | null;
  balanceMinor: number | null;
  orderTotalMinor: number | null;
  receivedShareMinor: number;
  paymentMode: string | null;
  paymentReceivedBy: string | null;
  profitMinor: number | null;
  deliveryDate: string | null;
  deliveredActual: boolean;
  salespersonId: string | null;
  salesperson: string | null;
  orderStatus: string;
  remarks: string | null;
  collectionStatus: string;
  isFirstLineOfOrder: boolean;
}

export interface FinancialReportTotals {
  lines: number;
  orders: number;
  saleMinor: number;
  costMinor: number;
  profitMinor: number;
  costedLines: number;
  costCoverageBps: number;
  orderTotalMinor: number;
  receivedMinor: number;
  balanceMinor: number;
}

export interface FinancialReportFilters {
  from?: string;
  to?: string;
  salespersonId?: string;
  customerId?: string;
  status?: string;
  collection?: string;
  paymentMode?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
  /** Ignore paging and return every matching row — used by the export. */
  all?: boolean;
}

export const adminReportsApi = {
  salesFinancial: (f: FinancialReportFilters = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === null || v === "" || v === false) continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return request<{
      rows: FinancialReportRow[];
      total: number;
      page: number;
      limit: number;
      pages: number;
      truncated: boolean;
      convention: string;
      totals: FinancialReportTotals;
    }>(`/admin/reports/sales-financial${s ? `?${s}` : ""}`);
  },
};
