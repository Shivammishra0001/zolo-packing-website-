// Seller onboarding + dashboard + admin-review API surface.
import { request, requestBlob } from "./api";

export type SupplierStatus =
  | "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "CHANGES_REQUESTED"
  | "APPROVED" | "REJECTED" | "SUSPENDED" | "INACTIVE";

export interface Completeness {
  sections: Record<string, boolean>;
  required: string[];
  missing: string[];
  canSubmit: boolean;
}

export interface OnboardingProfile {
  id: string;
  status: SupplierStatus;
  verificationStatus: string;
  onboardingStep: number;
  legalName?: string | null;
  displayName?: string | null;
  businessType?: string | null;
  registrationNumber?: string | null;
  website?: string | null;
  yearEstablished?: number | null;
  employeeCount?: number | null;
  annualTurnoverMinor?: number | null;
  description?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
  cinNumber?: string | null;
  rejectionReason?: string | null;
  locations: any[];
  capabilities: any[];
  certifications: any[];
  documents: any[];
  machinery: any[];
  materials: any[];
  bankAccounts: any[];
  capacity: any | null;
  quality: any | null;
  logistics: any | null;
  changeRequests: { id: string; issues: { section: string; message: string }[]; createdAt: string }[];
  completeness: Completeness;
}

export const onboardingApi = {
  // ---- Supplier catalog listings (ADR-001). Ownership and publication are
  // decided server-side from the session; nothing here can set them.
  products: (params: { status?: string; q?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
    return request<ListingPage>(`/sellers/me/products${qs ? `?${qs}` : ""}`);
  },
  createProduct: (body: Record<string, unknown>) =>
    request<SupplierListing>("/sellers/me/products", { method: "POST", body }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    request<SupplierListing>(`/sellers/me/products/${id}`, { method: "PATCH", body }),
  withdrawProduct: (id: string) =>
    request<SupplierListing>(`/sellers/me/products/${id}/withdraw`, { method: "POST" }),

  get: () => request<OnboardingProfile>("/sellers/me/onboarding"),
  patch: (data: Record<string, unknown>) => request<OnboardingProfile>("/sellers/me/onboarding", { method: "PATCH", body: data }),
  submit: () => request<{ status: SupplierStatus }>("/sellers/me/onboarding/submit", { method: "POST" }),

  /**
   * The whole application in one request. Replaces walking a dozen child
   * endpoints (locations, capabilities, bank, documents, machinery, …), which
   * is what the eleven-step wizard did and most suppliers never finished.
   */
  apply: (d: {
    contactName: string;
    companyName: string;
    website?: string;
    contactPhone: string;
    addressLine: string;
    city?: string;
    state?: string;
    postalCode?: string;
    categories: string[];
    bank?: { accountHolderName?: string; bankName?: string; accountNumber?: string; ifsc?: string };
  }) => request<{ status: SupplierStatus }>("/sellers/me/onboarding/apply", { method: "POST", body: d }),

  dashboard: () => request<any>("/sellers/me/dashboard"),
  suggestedCategories: () => request<{ categories: string[] }>("/sellers/me/ai/suggested-categories"),
  missingDocuments: () => request<{ missing: string[] }>("/sellers/me/ai/missing-documents"),
};

export interface AdminSellerListItem {
  id: string;
  displayName: string | null;
  legalName: string | null;
  businessType: string | null;
  status: SupplierStatus;
  verificationStatus: string;
  submittedAt: string | null;
  createdAt: string;
  organization: { id: string; name: string };
  _count: { documents: number; capabilities: number; locations: number };
}

/** One catalog listing owned by a supplier. */
export interface SupplierListing {
  id: string;
  sku: string;
  name: string;
  status: "draft" | "pending_review" | "active" | "archived";
  basePriceMinor: number;
  moq: number;
  stock: number;
  category: string;
  subcategory?: string;
  images: string[];
  updatedAt: string;
  rejectionNote?: string | null;
}

export interface ListingPage {
  products: SupplierListing[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  byStatus?: Record<string, number>;
}

export const adminSellerApi = {
  /** Every listing owned by one supplier, with status counts. */
  products: (id: string, params: { page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    return request<ListingPage>(`/admin/sellers/${id}/products${qs ? `?${qs}` : ""}`);
  },

  /** The cross-supplier moderation queue. */
  pendingListings: (params: { page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    return request<ListingPage>(`/admin/product-listings/pending${qs ? `?${qs}` : ""}`);
  },

  /** Approve a listing. Commission (basis points) is set here, by the admin. */
  approveListing: (id: string, commissionBps?: number) =>
    request<{ product: SupplierListing }>(`/admin/product-listings/${id}/approve`, {
      method: "POST",
      body: commissionBps === undefined ? {} : { commissionBps },
    }),

  /** Send a listing back with a reason the supplier can act on. */
  rejectListing: (id: string, reason: string) =>
    request<{ product: SupplierListing }>(`/admin/product-listings/${id}/reject`, { method: "POST", body: { reason } }),

  list: (params: { status?: string; verificationStatus?: string; businessType?: string; search?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return request<{ items: AdminSellerListItem[]; total: number }>(`/admin/sellers${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<any>(`/admin/sellers/${id}`),
  review: (id: string) => request<any>(`/admin/sellers/${id}/review`, { method: "POST" }),
  approve: (id: string) => request<any>(`/admin/sellers/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) => request<any>(`/admin/sellers/${id}/reject`, { method: "POST", body: { reason } }),
  requestChanges: (id: string, issues: { section: string; message: string }[]) => request<any>(`/admin/sellers/${id}/request-changes`, { method: "POST", body: { issues } }),
  suspend: (id: string, reason: string) => request<any>(`/admin/sellers/${id}/suspend`, { method: "POST", body: { reason } }),
  reactivate: (id: string) => request<any>(`/admin/sellers/${id}/reactivate`, { method: "POST" }),
  verifyDocument: (id: string, status: "VERIFIED" | "REJECTED", reason?: string) => request<any>(`/admin/documents/${id}/verify`, { method: "POST", body: { status, reason } }),
  // Streams the document's bytes through the authorized route. The caller is
  // responsible for revoking the object URL it creates from this blob.
  documentBlob: (id: string) => requestBlob(`/admin/documents/${id}/file`),
};
