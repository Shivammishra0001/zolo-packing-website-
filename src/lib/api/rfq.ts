// RFQ + Quotation API. Uses the authenticated client, which sends the caller's
// JWT; the backend gates /admin/rfqs with requireAdmin and scopes buyer routes
// to the token's own user, so ownership is never decided in the browser.
import { request, requestBlob } from "./client";

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

/** Who priced a quotation: a competing seller, or the house (null). */
export interface QuotationSeller {
  id: string;
  name: string;
  verificationStatus: string;
}

export interface RfqFileMeta {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Quotation {
  id: string;
  quotationNumber: string;
  version: number;
  status: QuotationStatus;
  seller: QuotationSeller | null;
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
  /** How many sellers were invited to quote. */
  matchCount: number;
  ship: { city: string | null; state: string | null; postalCode: string | null; country: string | null };
  customer?: { id: string; email: string; name: string; phone?: string | null };
  items: RfqItem[];
  files: RfqFileMeta[];
  quotations: Quotation[];
}

/** Admin detail extras: the matched-seller shortlist + the audit trail. */
export interface RfqMatchInfo {
  id: string;
  supplierId: string;
  status: "INVITED" | "VIEWED" | "QUOTED" | "DECLINED";
  score: number;
  reasons: string[];
  viewedAt: string | null;
  respondedAt: string | null;
  supplier: { id: string; name: string; verificationStatus: string; status: string } | null;
}

export interface RfqActivityEntry {
  id: string;
  eventType: string;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminRfqDetail extends Rfq {
  matches: RfqMatchInfo[];
  activity: RfqActivityEntry[];
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
  /**
   * false = create as DRAFT so requirement sheets can be uploaded first, then
   * finalize with rfqApi.submit(). Defaults to true (immediate submission).
   */
  submit?: boolean;
}

/** Read a File into the base64 payload the upload endpoint expects. */
export async function fileToUploadPayload(file: File): Promise<{ fileName: string; mime: string; dataBase64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mime: file.type, dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
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

  /** Finalize a DRAFT created with submit:false (files-first flow). */
  submit: (id: string) => request<Rfq>(`/rfqs/${id}/submit`, { method: "POST" }),

  /** Attach a requirement sheet (xlsx/xls/csv/pdf/doc/docx/images, ≤10 MB). */
  attachFile: (id: string, payload: { fileName: string; mime: string; dataBase64: string }) =>
    request<RfqFileMeta>(`/rfqs/${id}/files`, { method: "POST", body: payload }),

  listFiles: (id: string) => request<{ files: RfqFileMeta[] }>(`/rfqs/${id}/files`),

  downloadFile: (id: string, fileId: string) => requestBlob(`/rfqs/${id}/files/${fileId}/download`),

  removeFile: (id: string, fileId: string) =>
    request<{ deleted: boolean }>(`/rfqs/${id}/files/${fileId}`, { method: "DELETE" }),

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

  /** Read the buyer↔seller message thread for a given supplier on an RFQ. */
  listMessages: (rfqId: string, supplierId: string) =>
    request<{ messages: RfqMessage[] }>(`/rfqs/${rfqId}/messages?supplierId=${encodeURIComponent(supplierId)}`),

  /** Post a message into the buyer↔seller thread. */
  postMessage: (rfqId: string, supplierId: string, body: string) =>
    request<RfqMessage>(`/rfqs/${rfqId}/messages`, { method: "POST", body: { supplierId, body } }),

  /**
   * Rule-based packaging assistant. Given a free-text brief it returns EDITABLE
   * suggestions (never auto-submitted) plus matching store products.
   */
  assist: (prompt: string) =>
    request<RfqAssistResult>("/rfqs/assist", { method: "POST", body: { prompt } }),
};

export interface RfqMessage {
  id: string;
  rfqId: string;
  supplierId: string | null;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

// ---- Customer <-> Admin negotiation chat --------------------------------

export type ChatSenderType = "CUSTOMER" | "ADMIN";
export type ChatMessageType = "TEXT" | "FILE" | "QUOTE" | "SYSTEM";

export interface ChatFileRef { id: string; fileName: string; mimeType: string; size: number }
export interface ChatQuoteRef {
  id: string; quotationNumber: string; version: number; status: QuotationStatus;
  grandTotalMinor: number; subtotalMinor: number; shippingMinor: number; taxMinor: number;
  currency: string; leadTimeDays: number | null; validUntil: string | null;
  items: { quantity: number; unit: string; unitPriceMinor: number; productName: string }[];
}

export interface ChatMessage {
  id: string;
  rfqId: string;
  senderId: string;
  senderType: ChatSenderType;
  senderName: string;
  type: ChatMessageType;
  body: string;
  file: ChatFileRef | null;
  quote: ChatQuoteRef | null;
  readAt: string | null;
  createdAt: string;
  /** Optimistic echo id, present only on the socket 'new_message' for the sender. */
  tempId?: string;
}

export interface ChatContext {
  rfqId: string;
  rfqNumber: string;
  status: RfqStatus;
  role: ChatSenderType;
  ship: { city: string | null; state: string | null };
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  items: { id: string; productName: string; sku: string | null; quantity: number; unit: string; specs: Record<string, unknown> }[];
  currentQuote: { id: string; quotationNumber: string; version: number; status: QuotationStatus; grandTotalMinor: number; currency: string; leadTimeDays: number | null; validUntil: string | null } | null;
}

export interface ChatInboxItem {
  rfqId: string;
  rfqNumber: string;
  status: RfqStatus;
  customer: { id: string; name: string; email: string | null; phone: string | null };
  productCount: number;
  unread: number;
  lastMessage: { preview: string; at: string; fromCustomer: boolean } | null;
  lastAt: string | null;
}

const chatBase = (admin: boolean) => (admin ? "/admin/rfqs" : "/rfqs");

export const chatApi = {
  /** Paginated history (chronological). `before` = ISO cursor of oldest loaded. */
  messages: (rfqId: string, opts: { before?: string; limit?: number } = {}, admin = false) => {
    const qs = new URLSearchParams();
    if (opts.before) qs.set("before", opts.before);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const s = qs.toString();
    return request<{ messages: ChatMessage[]; hasMore: boolean; oldestCursor: string | null }>(
      `${chatBase(admin)}/${rfqId}/chat${s ? `?${s}` : ""}`,
    );
  },
  context: (rfqId: string, admin = false) => request<ChatContext>(`${chatBase(admin)}/${rfqId}/chat/context`),
  /** Per-RFQ unread counts for the signed-in buyer's own RFQs (for badges). */
  unreadCounts: () => request<{ counts: Record<string, number> }>("/rfqs/chat/unread-counts"),
  send: (rfqId: string, body: string, admin = false) =>
    request<ChatMessage>(`${chatBase(admin)}/${rfqId}/chat`, { method: "POST", body: { body } }),
  read: (rfqId: string, admin = false) =>
    request<{ updated: number }>(`${chatBase(admin)}/${rfqId}/chat/read`, { method: "POST" }),
  attach: (rfqId: string, payload: { fileName: string; mime: string; dataBase64: string }, admin = false) =>
    request<ChatMessage>(`${chatBase(admin)}/${rfqId}/chat/attachments`, { method: "POST", body: payload }),
  /** Admin inbox of all negotiation conversations. */
  inbox: (sort: "unread" | "latest" | "rfq" | "customer" = "unread") =>
    request<{ conversations: ChatInboxItem[] }>(`/admin/rfqs/chat/inbox?sort=${sort}`),
  /** Admin sends a revised quotation that appears as a quote card. */
  sendQuote: (rfqId: string, input: { items: QuotationDraftItem[]; leadTimeDays?: number; validUntil?: string; shippingMinor?: number; discountMinor?: number; paymentTerms?: string; note?: string }) =>
    request<{ quotation: Quotation; message: ChatMessage }>(`/admin/rfqs/${rfqId}/chat/quote`, { method: "POST", body: input }),
};

/** A store product the assistant suggests the buyer consider. */
export interface RfqAssistProduct {
  id: string;
  name: string;
  sku: string | null;
  slug: string | null;
  category: string | null;
}

/** Editable suggestions from the rule-based packaging assistant. */
export interface RfqAssistResult {
  productType: string | null;
  category: string | null;
  material: string | null;
  color: string | null;
  dimensions: string | null;
  quantity: number | null;
  unit: string | null;
  printing: string | null;
  note: string;
  products: RfqAssistProduct[];
}

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

  /** Detail by internal id OR human RFQ-xxxx number (the table links by number). */
  get: (idOrNumber: string) => request<AdminRfqDetail>(`/admin/rfqs/${encodeURIComponent(idOrNumber)}`),

  markUnderReview: (id: string) => request<Rfq>(`/admin/rfqs/${id}/review`, { method: "POST" }),

  downloadFile: (rfqId: string, fileId: string) => requestBlob(`/admin/rfqs/${rfqId}/files/${fileId}/download`),

  /** Re-run supplier matching (e.g. after new sellers were approved). */
  rematch: (rfqId: string) => request<{ invited: number }>(`/admin/rfqs/${rfqId}/match`, { method: "POST" }),

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
