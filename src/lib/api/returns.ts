// Returns & recycling API — customer side + admin processing.
// Requests are CUSTOMER-created; admin endpoints only review and process.
import { request, requestBlob } from "./client";

export type ReturnKind = "RETURN" | "RECYCLE";
export type ReturnResolution = "REFUND" | "REPLACEMENT" | "RECYCLE";
export type ReturnStatus =
  | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED"
  | "PICKUP_SCHEDULED" | "RECEIVED" | "INSPECTED"
  | "REFUND_PROCESSING" | "REFUNDED"
  | "REPLACEMENT_PROCESSING" | "REPLACEMENT_SHIPPED" | "REPLACEMENT_DELIVERED"
  | "RECYCLE_PROCESSING" | "RECYCLED" | "POINTS_CREDITED"
  | "CLOSED" | "CANCELLED";

export const RETURN_REASON_LABELS: Record<string, string> = {
  damaged: "Damaged product",
  wrong_product: "Wrong product",
  defective: "Defective product",
  incorrect_quantity: "Incorrect quantity",
  not_as_expected: "Not as expected",
  recycle: "Recycling",
  other: "Other",
};

export const RETURN_CONDITION_LABELS: Record<string, string> = {
  unused: "Unused",
  opened: "Opened",
  damaged: "Damaged",
  used: "Used",
  packaging_damaged: "Packaging damaged",
};

export interface ReturnTimelineEntry {
  id: string;
  status: ReturnStatus;
  note: string | null;
  at: string;
}

export interface ReturnFileMeta {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  requestNumber: string;
  type: ReturnKind;
  status: ReturnStatus;
  resolution: ReturnResolution | null;
  quantity: number;
  reason: string;
  condition: string;
  description: string | null;
  order?: { id: string; orderNumber: string; placedAt: string };
  item?: { id: string; productName: string; sku: string | null; purchasedQuantity: number; unitPriceMinor: number; lineTotalMinor: number };
  pickup: { name: string | null; phone: string | null; line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null };
  rejectionReason: string | null;
  replacement?: { quantity: number | null; courier: string | null; tracking: string | null; shippedAt: string | null; deliveredAt: string | null };
  recycle?: { pickupScheduledFor: string | null; receivedQuantity: number | null; acceptedQuantity: number | null; rejectedQuantity: number | null; inspectionNotes?: string | null };
  pointsAwarded: number | null;
  refund: { refundNumber: string; amountMinor: number; status: string; reference?: string | null; processedAt: string | null } | null;
  files: ReturnFileMeta[];
  timeline: ReturnTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface AdminReturnDetail extends ReturnRequest {
  adminNotes: string | null;
  sellerId: string | null;
  customer?: { id: string; name: string; email: string; phone: string | null };
  previousRequests: number;
}

export interface AdminReturnRow {
  id: string;
  requestNumber: string;
  type: ReturnKind;
  status: ReturnStatus;
  resolution: ReturnResolution | null;
  quantity: number;
  productName: string;
  orderNumber: string;
  customer: string;
  createdAt: string;
}

export interface PointsLedgerRow {
  id: string;
  type: string;
  points: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export const returnsApi = {
  list: (type?: ReturnKind) => request<{ requests: ReturnRequest[] }>(`/returns${type ? `?type=${type}` : ""}`),
  get: (id: string) => request<ReturnRequest>(`/returns/${id}`),
  create: (input: {
    orderItemId: string;
    type: ReturnKind;
    quantity: number;
    reason: string;
    condition: string;
    description?: string;
    pickupAddressId: string;
  }) => request<ReturnRequest>("/returns", { method: "POST", body: input }),
  cancel: (id: string) => request<ReturnRequest>(`/returns/${id}/cancel`, { method: "POST" }),
  estimate: (orderItemId: string, quantity: number) =>
    request<{ quantity: number; remaining: number; estimatedPoints: number; note: string }>(
      `/returns/estimate?orderItemId=${encodeURIComponent(orderItemId)}&quantity=${quantity}`,
    ),
  points: () => request<{ balance: number; ledger: PointsLedgerRow[] }>("/returns/points"),
  attachFile: (id: string, payload: { fileName: string; mime: string; dataBase64: string }) =>
    request<ReturnFileMeta>(`/returns/${id}/files`, { method: "POST", body: payload }),
  downloadFile: (id: string, fileId: string) => requestBlob(`/returns/${id}/files/${fileId}/download`),
};

export const adminReturnsApi = {
  list: (filters: { type?: string; status?: string; resolution?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    const s = qs.toString();
    return request<{ requests: AdminReturnRow[]; total: number; counts: Record<string, number> }>(
      `/admin/returns${s ? `?${s}` : ""}`,
    );
  },
  get: (idOrNumber: string) => request<AdminReturnDetail>(`/admin/returns/${encodeURIComponent(idOrNumber)}`),
  review: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/review`, { method: "POST" }),
  approve: (id: string, notes?: string) => request<AdminReturnDetail>(`/admin/returns/${id}/approve`, { method: "POST", body: { notes } }),
  reject: (id: string, reason: string) => request<AdminReturnDetail>(`/admin/returns/${id}/reject`, { method: "POST", body: { reason } }),
  setResolution: (id: string, body: { resolution: ReturnResolution; replacementQuantity?: number; notes?: string }) =>
    request<AdminReturnDetail>(`/admin/returns/${id}/resolution`, { method: "POST", body }),
  refund: (id: string, body: { amountMinor: number; reference: string; notes?: string }) =>
    request<AdminReturnDetail>(`/admin/returns/${id}/refund`, { method: "POST", body }),
  shipReplacement: (id: string, body: { courier?: string; trackingNumber?: string }) =>
    request<AdminReturnDetail>(`/admin/returns/${id}/replacement/ship`, { method: "POST", body }),
  deliverReplacement: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/replacement/deliver`, { method: "POST" }),
  schedulePickup: (id: string, date: string) => request<AdminReturnDetail>(`/admin/returns/${id}/recycle/pickup`, { method: "POST", body: { date } }),
  markReceived: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/recycle/received`, { method: "POST" }),
  inspect: (id: string, body: { receivedQuantity: number; acceptedQuantity: number; rejectedQuantity?: number; notes?: string }) =>
    request<AdminReturnDetail>(`/admin/returns/${id}/recycle/inspection`, { method: "POST", body }),
  startRecycle: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/recycle/start`, { method: "POST" }),
  completeRecycle: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/recycle/complete`, { method: "POST" }),
  creditPoints: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/recycle/credit-points`, { method: "POST" }),
  close: (id: string) => request<AdminReturnDetail>(`/admin/returns/${id}/close`, { method: "POST" }),
  downloadFile: (id: string, fileId: string) => requestBlob(`/admin/returns/${id}/files/${fileId}/download`),
};

export const prettyReturnStatus = (s: ReturnStatus) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
