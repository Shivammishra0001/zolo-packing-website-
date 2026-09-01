// Seller marketplace API — RFQ leads, quoting, requirement-sheet download.
// Uses the seller portal's own token store (zolo.seller.*). The backend derives
// supplierId from the session, so nothing here can act as another seller.
import { request, requestBlob } from "./api";

export interface LeadRfqItem {
  id: string;
  productName: string;
  sku: string | null;
  specs: Record<string, unknown>;
  quantity: number;
  unit: string;
  notes: string | null;
}

export interface LeadFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface SellerLead {
  matchId: string;
  status: "INVITED" | "VIEWED" | "QUOTED" | "DECLINED";
  score: number;
  reasons: string[];
  invitedAt: string;
  rfq: {
    id: string;
    rfqNumber: string;
    title: string | null;
    notes: string | null;
    status: string;
    requiredBy: string | null;
    itemCount: number;
    totalQuantity: number;
    items: LeadRfqItem[];
    files: LeadFile[];
    ship: { city: string | null; state: string | null };
  };
}

export interface SellerQuoteInput {
  items: { rfqItemId: string; unitPriceMinor: number; quantity?: number }[];
  shippingMinor?: number;
  discountMinor?: number;
  leadTimeDays?: number;
  paymentTerms?: string;
  validUntil?: string;
  notes?: string;
}

export const sellerRfqApi = {
  leads: () => request<{ leads: SellerLead[] }>("/sellers/rfqs"),

  markViewed: (rfqId: string) => request<unknown>(`/sellers/rfqs/${rfqId}/view`, { method: "POST" }),

  decline: (rfqId: string) => request<unknown>(`/sellers/rfqs/${rfqId}/decline`, { method: "POST" }),

  /** Submit or revise a quote. Totals are computed server-side. */
  quote: (rfqId: string, input: SellerQuoteInput) =>
    request<{ quotationNumber: string; version: number; grandTotalMinor: number }>(`/sellers/rfqs/${rfqId}/quote`, {
      method: "POST",
      body: input,
    }),

  downloadFile: (rfqId: string, fileId: string) => requestBlob(`/sellers/rfqs/${rfqId}/files/${fileId}/download`),
};
