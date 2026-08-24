// Admin AI product-generation API. Uses the storefront authenticated client
// (admin JWT in zolo.store.accessToken); the backend gates /admin with an admin
// role check, so a non-admin token is rejected server-side.
import { request } from "./client";

export interface AiConfidence {
  overall?: number;
  name?: number;
  category?: number;
  material?: number;
}

export type AiAnalysisStatus =
  | "NOT_ANALYZED" | "ANALYZING" | "ANALYZED"
  | "REVIEW_REQUIRED" | "FAILED" | "APPROVED" | "REJECTED";

export interface AiAnalysis {
  id: string;
  imageHash: string;
  sourceName: string;
  status: AiAnalysisStatus;
  name: string | null;
  suggestedSku: string | null;
  category: string | null;
  isNewCategory: boolean;
  productType: string | null;
  material: string | null;
  color: string | null;
  shape: string | null;
  usage: string[];
  description: string | null;
  shortDescription: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  imageUrl: string | null;
  confidence: AiConfidence;
  reviewReason: string | null;
  productId: string | null;
  cached?: boolean;
}

export interface AnalysesResponse {
  total: number;
  ready: number;
  reviewRequired: number;
  approved: number;
  rejected: number;
  analyses: AiAnalysis[];
}

export interface ApproveOverrides {
  name?: string;
  sku?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  color?: string;
  material?: string;
  basePriceMinor?: number;
}

export const aiProductsApi = {
  listImages: () => request<{ images: { filename: string }[] }>("/admin/ai/images"),
  listAnalyses: () => request<AnalysesResponse>("/admin/ai/analyses"),
  analyze: (filenames: string[], force = false) =>
    request<AnalysesResponse>("/admin/ai/analyze", { method: "POST", body: { filenames, force } }),
  approve: (id: string, overrides: ApproveOverrides = {}, dupeMode: "update" | "skip" | "create-new" = "update") =>
    request<{ action: string; sku: string; product?: { id: string; status: string; name: string } }>(
      `/admin/ai/analyses/${id}/approve`,
      { method: "POST", body: { overrides, dupeMode } },
    ),
  reject: (id: string) => request<{ rejected: boolean }>(`/admin/ai/analyses/${id}/reject`, { method: "POST" }),
};
