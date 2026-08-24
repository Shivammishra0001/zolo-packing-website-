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
  get: () => request<OnboardingProfile>("/sellers/me/onboarding"),
  patch: (data: Record<string, unknown>) => request<OnboardingProfile>("/sellers/me/onboarding", { method: "PATCH", body: data }),
  submit: () => request<{ status: SupplierStatus }>("/sellers/me/onboarding/submit", { method: "POST" }),

  addLocation: (d: Record<string, unknown>) => request<any>("/sellers/me/locations", { method: "POST", body: d }),
  removeLocation: (id: string) => request<any>(`/sellers/me/locations/${id}`, { method: "DELETE" }),
  addCapability: (d: Record<string, unknown>) => request<any>("/sellers/me/capabilities", { method: "POST", body: d }),
  removeCapability: (id: string) => request<any>(`/sellers/me/capabilities/${id}`, { method: "DELETE" }),
  addMachine: (d: Record<string, unknown>) => request<any>("/sellers/me/machinery", { method: "POST", body: d }),
  removeMachine: (id: string) => request<any>(`/sellers/me/machinery/${id}`, { method: "DELETE" }),
  addMaterial: (d: Record<string, unknown>) => request<any>("/sellers/me/materials", { method: "POST", body: d }),
  removeMaterial: (id: string) => request<any>(`/sellers/me/materials/${id}`, { method: "DELETE" }),
  addCertification: (d: Record<string, unknown>) => request<any>("/sellers/me/certifications", { method: "POST", body: d }),
  removeCertification: (id: string) => request<any>(`/sellers/me/certifications/${id}`, { method: "DELETE" }),
  addBankAccount: (d: Record<string, unknown>) => request<any>("/sellers/me/bank-accounts", { method: "POST", body: d }),
  removeBankAccount: (id: string) => request<any>(`/sellers/me/bank-accounts/${id}`, { method: "DELETE" }),

  saveCapacity: (d: Record<string, unknown>) => request<any>("/sellers/me/capacity", { method: "PUT", body: d }),
  saveQuality: (d: Record<string, unknown>) => request<any>("/sellers/me/quality", { method: "PUT", body: d }),
  saveLogistics: (d: Record<string, unknown>) => request<any>("/sellers/me/logistics", { method: "PUT", body: d }),

  listDocuments: () => request<any[]>("/sellers/me/documents"),
  uploadDocument: (d: { type: string; fileName: string; mime: string; dataBase64: string; expiresAt?: string | null }) =>
    request<any>("/sellers/me/documents", { method: "POST", body: d }),
  removeDocument: (id: string) => request<any>(`/sellers/me/documents/${id}`, { method: "DELETE" }),

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

export const adminSellerApi = {
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
