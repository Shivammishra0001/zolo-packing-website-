// Admin client for the AdSens showcase: campaign previews and portfolio
// case studies. These are what the two dark rails on /adsens render; nothing
// on that page is hardcoded, so this is the only way the content exists.
//
// Two fields carry the honesty rules the server enforces:
//   isIllustrative   a sample preview. The public API rewrites its status to
//                    "illustrative", so it can never show a LIVE badge. A row
//                    with isIllustrative = false MUST have a clientName.
//   resultsVerified  only verified results are sent to the public page. The
//                    server refuses to set this flag with no results behind it.
import { request } from "./client";

export type CampaignPlatform = "meta" | "google" | "linkedin" | "email" | "youtube" | "whatsapp" | "other";
export type AdminCampaignStatus = "live" | "completed" | "paused";

export interface AdminCampaign {
  id: string;
  slug: string;
  title: string;
  clientName: string | null;
  platform: CampaignPlatform;
  imageUrl: string | null;
  status: AdminCampaignStatus;
  metric1Label: string | null;
  metric1Value: string | null;
  metric2Label: string | null;
  metric2Value: string | null;
  isIllustrative: boolean;
  isPublished: boolean;
  sortOrder: number;
  caseStudyId: string | null;
  caseStudy: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type CampaignInput = Partial<
  Pick<
    AdminCampaign,
    | "title" | "clientName" | "platform" | "imageUrl" | "status"
    | "metric1Label" | "metric1Value" | "metric2Label" | "metric2Value"
    | "isIllustrative" | "isPublished" | "sortOrder" | "caseStudyId"
  >
>;

export interface AdminCaseStudy {
  id: string;
  slug: string;
  title: string;
  clientName: string | null;
  industry: string | null;
  category: string;
  coverImage: string | null;
  summary: string | null;
  overview: string | null;
  strategy: string | null;
  execution: string | null;
  servicesProvided: string[];
  gallery: string[];
  results: string[];
  resultsVerified: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type CaseStudyInput = Partial<
  Pick<
    AdminCaseStudy,
    | "title" | "clientName" | "industry" | "category" | "coverImage" | "summary"
    | "overview" | "strategy" | "execution" | "servicesProvided" | "gallery"
    | "results" | "resultsVerified" | "isPublished" | "sortOrder"
  >
>;

const BASE = "/admin/marketing";

export const showcaseApi = {
  listCampaigns: () => request<{ campaigns: AdminCampaign[] }>(`${BASE}/campaigns`),
  createCampaign: (body: CampaignInput) =>
    request<{ campaign: AdminCampaign }>(`${BASE}/campaigns`, { method: "POST", body }),
  updateCampaign: (id: string, body: CampaignInput) =>
    request<{ campaign: AdminCampaign }>(`${BASE}/campaigns/${id}`, { method: "PATCH", body }),
  deleteCampaign: (id: string) => request<{ id: string }>(`${BASE}/campaigns/${id}`, { method: "DELETE" }),

  listCaseStudies: () => request<{ caseStudies: AdminCaseStudy[] }>(`${BASE}/case-studies`),
  createCaseStudy: (body: CaseStudyInput) =>
    request<{ caseStudy: AdminCaseStudy }>(`${BASE}/case-studies`, { method: "POST", body }),
  updateCaseStudy: (id: string, body: CaseStudyInput) =>
    request<{ caseStudy: AdminCaseStudy }>(`${BASE}/case-studies/${id}`, { method: "PATCH", body }),
  deleteCaseStudy: (id: string) => request<{ id: string }>(`${BASE}/case-studies/${id}`, { method: "DELETE" }),
};

export const PLATFORM_LABEL: Record<CampaignPlatform, string> = {
  meta: "Meta", google: "Google", linkedin: "LinkedIn", email: "Email",
  youtube: "YouTube", whatsapp: "WhatsApp", other: "Other",
};
