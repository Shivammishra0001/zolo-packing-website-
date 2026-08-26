// RFQ + Quotation API. Uses the authenticated client, which sends the caller's
// JWT; the backend gates /admin/rfqs with requireAdmin and scopes buyer routes
// to the token's own user, so ownership is never decided in the browser.
import { request } from "./client";

export type RfqStatus =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "QUOTED"
  | "ACCEPTED" | "REJECTED" | "CANCELLED" | "EXPIRED";

export type QuotationStatus =
  | "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED"
  | "CHANGES_REQUESTED" | "EXPIRED" | "WITHDRAWN";

export interface RfqItem {
  id: string;
  productId: string | null;
  productName: string;
  sku: string | null;
  variant: string | null;
  specs: Record<string, unknown>;
  quantity: number;
  unit: string;
  targetPriceMinor: number | null;
  notes: string | null;
}

export interface QuotationItem {
  id: string;
  rfqItemId: string | null;
  productId: string | null;
  productName: string;
  sku: string | null;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
  notes: string | null;
}

export interface Quotation {
  id: string;
  quotationNumber: string;
  version: number;
  status: QuotationStatus;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  grandTotalMinor: number;
  currency: string;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  terms: string | null;
  notes: string | null;
  buyerMessage: string | null;
  validUntil: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  items: QuotationItem[];
}

export interface Rfq {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  title: string | null;
  notes: string | null;
  currency: string;
  requiredBy: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  totalQuantity: number;
  ship: { city: string | null; state: string | null; postalCode: string | null; country: string | null };
  customer?: { id: string; email: string; name: string };
  items: RfqItem[];
  quotations: Quotation[];
}

/** One line the buyer is asking to have priced. */
export interface RfqDraftItem {
  productId?: string;
  productName?: string;
  sku?: string;
  variant?: string;
  specs?: Record<string, unknown>;
  quantity: number;
  unit?: string;
  targetPriceMinor?: number;
  notes?: string;
}

export interface CreateRfqInput {
  items: RfqDraftItem[];
  title?: string;
  notes?: string;
  requiredBy?: string;
  ship?: { city?: string; state?: string; postalCode?: string; country?: string };
}

export const rfqApi = {
  /** The signed-in buyer's own RFQs. */
  list: (status?: RfqStatus) =>
    request<{ rfqs: Rfq[] }>(`/rfqs${status ? `?status=${status}` : ""}`),

  get: (id: string) => request<Rfq>(`/rfqs/${id}`),

  /** Submit the whole RFQ cart as ONE request with many items. */
  create: (input: CreateRfqInput) =>
    request<Rfq>("/rfqs", { method: "POST", body: input }),

  cancel: (id: string) => request<Rfq>(`/rfqs/${id}/cancel`, { method: "POST" }),

  /** Accept a quotation — the server converts it into an order. */
  accept: (quotationId: string) =>
    request<{ quotation: Quotation; order: { id: string; orderNumber: string } }>(
      `/quotations/${quotationId}/accept`,
      { method: "POST" },
    ),

  respond: (quotationId: string, action: "reject" | "request_changes", message?: string) =>
    request<Quotation>(`/quotations/${quotationId}/respond`, {
      method: "POST",
      body: { action, message },
    }),
};

export interface AdminRfqFilters {
  status?: RfqStatus;
  q?: string;
  take?: number;
  skip?: number;
}

export interface QuotationDraftItem {
  rfqItemId?: string;
  productId?: string;
  productName?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  unitPriceMinor: number;
  discountMinor?: number;
  taxMinor?: number;
  notes?: string;
}

export const adminRfqApi = {
  list: (filters: AdminRfqFilters = {}) => {
    const qs = new URLSearchParams();
    if (filters.status) qs.set("status", filters.status);
    if (filters.q) qs.set("q", filters.q);
    if (filters.take != null) qs.set("take", String(filters.take));
    if (filters.skip != null) qs.set("skip", String(filters.skip));
    const s = qs.toString();
    return request<{ rfqs: Rfq[]; total: number }>(`/admin/rfqs${s ? `?${s}` : ""}`);
  },

  get: (id: string) => request<Rfq>(`/admin/rfqs/${id}`),

  markUnderReview: (id: string) => request<Rfq>(`/admin/rfqs/${id}/review`, { method: "POST" }),

  /**
   * Price an RFQ. Line totals are computed server-side from quantity x unit
   * price, so the browser never decides what anything costs.
   */
  createQuotation: (
    rfqId: string,
    input: {
      items: QuotationDraftItem[];
      leadTimeDays?: number;
      paymentTerms?: string;
      terms?: string;
      notes?: string;
      validUntil?: string;
      shippingMinor?: number;
      discountMinor?: number;
      send?: boolean;
    },
  ) => request<Quotation>(`/admin/rfqs/${rfqId}/quotations`, { method: "POST", body: input }),
};
