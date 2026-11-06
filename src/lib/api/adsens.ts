// AdSens by Zolo — public catalog + consultation submission.
//
// These two endpoints are PUBLIC: no token is attached, because a visitor
// requesting a consultation has no account. Everything else about AdSens
// (leads, pipeline) is admin-only and lives in admin-adsens.ts.
import { API_BASE } from "../api-config";

export interface AdsensService {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  deliverables: string[];
  icon: string | null;
}

export interface AdsensPackage {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  /** Paise. NULL means quote-only — render "Custom quote", never ₹0. */
  priceMinor: number | null;
  billingPeriod: string;
  deliverables: string[];
  isFeatured: boolean;
  services: { slug: string; name: string }[];
}

// ---- Showcase: campaigns + portfolio ----
//
// All of this is admin-entered. The two fields that look like marketing
// claims are deliberately constrained at the source:
//   status "illustrative"  the server returns this for any sample preview,
//                          so the UI cannot badge it LIVE.
//   resultsVerified        false means the `results` array arrives EMPTY —
//                          the server strips it, the page never sees it.

export type CampaignPlatform = "meta" | "google" | "linkedin" | "email" | "youtube" | "whatsapp" | "other";
export type CampaignStatus = "live" | "completed" | "paused" | "illustrative";

export interface AdsensCampaign {
  id: string;
  slug: string;
  title: string;
  clientName: string | null;
  platform: CampaignPlatform;
  imageUrl: string | null;
  status: CampaignStatus;
  isIllustrative: boolean;
  /** Only complete label+value pairs arrive. May be empty. */
  metrics: { label: string; value: string }[];
  caseStudySlug: string | null;
}

export interface AdsensCaseStudyCard {
  id: string;
  slug: string;
  title: string;
  clientName: string | null;
  industry: string | null;
  category: string;
  coverImage: string | null;
  summary: string | null;
  resultsVerified: boolean;
}

export interface AdsensCaseStudy extends AdsensCaseStudyCard {
  overview: string | null;
  strategy: string | null;
  execution: string | null;
  servicesProvided: string[];
  gallery: string[];
  /** Empty unless resultsVerified. Never populate this client-side. */
  results: string[];
}

export interface AdsensShowcase {
  campaigns: AdsensCampaign[];
  caseStudies: AdsensCaseStudyCard[];
  /** Derived server-side from published work — never a hardcoded list. */
  categories: string[];
}

export interface ConsultationInput {
  fullName: string;
  email: string;
  phone: string;
  companyName?: string;
  website?: string;
  industry?: string;
  location?: string;
  services?: string[];
  budgetRange?: string;
  challenges?: string;
  requirement?: string;
  packageId?: string;
  preferredContact?: "phone" | "email" | "whatsapp";
  bestTimeToContact?: string;
  consent: boolean;
}

export interface ConsultationResult {
  leadNumber: string;
  duplicate: boolean;
  message: string;
}

/** Thrown with the server's own message, which is written for the visitor. */
export class AdsensError extends Error {
  code?: string;
  status: number;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AdsensError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new AdsensError(0, "We couldn't reach our server. Please check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new AdsensError(res.status, body?.error ?? "Something went wrong. Please try again.", body?.code);
  }
  return body.data as T;
}

export const adsensApi = {
  catalog: () => call<{ services: AdsensService[]; packages: AdsensPackage[] }>("/public/adsens/catalog"),
  showcase: () => call<AdsensShowcase>("/public/adsens/showcase"),
  caseStudy: (slug: string) =>
    call<{ caseStudy: AdsensCaseStudy }>(`/public/adsens/case-studies/${encodeURIComponent(slug)}`),
  submitConsultation: (input: ConsultationInput) =>
    call<ConsultationResult>("/public/adsens/consultation", { method: "POST", body: JSON.stringify(input) }),
};
