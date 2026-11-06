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
  submitConsultation: (input: ConsultationInput) =>
    call<ConsultationResult>("/public/adsens/consultation", { method: "POST", body: JSON.stringify(input) }),
};
