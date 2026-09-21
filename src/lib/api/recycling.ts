// Typed client for Recycling + Eco Credits.
//
//   material → verified quantity → active rule → credits/unit → Eco Credits
//   → wallet → redemption → customer-specific coupon → checkout
//
// The client never sends a credit amount, a coupon value or a verified
// quantity on the customer's behalf: every figure shown comes back from the API.
import { request, requestBlob } from "./client";

export type RecyclingUnit = "kg" | "g" | "piece" | "litre";
export const RECYCLING_UNITS: RecyclingUnit[] = ["kg", "g", "piece", "litre"];
export const UNIT_LABEL: Record<RecyclingUnit, string> = { kg: "kg", g: "g", piece: "piece", litre: "litre" };

export type RecyclingStatus = "PENDING" | "PICKUP_SCHEDULED" | "RECEIVED" | "UNDER_VERIFICATION" | "APPROVED" | "REJECTED" | "CANCELLED";
export const RECYCLING_STATUS_LABEL: Record<RecyclingStatus, string> = {
  PENDING: "Pending", PICKUP_SCHEDULED: "Scheduled pickup", RECEIVED: "Received", UNDER_VERIFICATION: "Under verification",
  APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled",
};
export const RECYCLING_CONDITIONS = ["clean", "mixed", "contaminated", "damaged"] as const;
export type RecyclingCondition = (typeof RECYCLING_CONDITIONS)[number];

// ---------- programme (public) ----------
export interface ProgramMaterial {
  ruleId: string; material: string; unit: RecyclingUnit; creditsPerUnit: number; minQuantity: number | null; maxQuantity: number | null;
}
export interface RewardInfo {
  enabled: boolean;
  creditsRequired: number | null;
  couponValueMinor: number | null;
  couponValidityDays: number | null;
  couponMinOrderMinor: number | null;
  minCreditsToRedeem: number | null;
  maxUnitsPerRedemption: number | null;
  appliesTo: "all" | "products" | "categories" | null;
  creditExpiryDays: number | null;
}
export interface RecyclingProgram { materials: ProgramMaterial[]; reward: RewardInfo }

// ---------- requests ----------
export interface Calculation {
  ruleId?: string | null; material?: string | null; unit?: RecyclingUnit | null; verifiedQuantity?: number | null;
  creditsPerUnit?: number | null; credits?: number | null; formula?: string; rounding?: string;
  /** true = frozen at approval; false = live preview from the current rule */
  snapshot: boolean;
  error?: string; code?: string | null;
}
export interface RecyclingFileMeta { id: string; fileName: string; mimeType: string; size: number; createdAt: string }
export interface RecyclingRequest {
  id: string; requestNumber: string; status: RecyclingStatus; material: string; unit: RecyclingUnit;
  estimatedQuantity: number; description: string | null;
  pickup: { name: string | null; phone: string | null; line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null; scheduledFor: string | null };
  receivedAt: string | null; verifiedQuantity: number | null; creditsAwarded: number | null; calculation: Calculation | null;
  rejectionReason: string | null; files: RecyclingFileMeta[]; timeline: { status: RecyclingStatus; at: string; note: string | null }[];
  createdAt: string; approvedAt: string | null; closedAt: string | null;
}
export interface RecyclingRule {
  id: string; material: string; unit: RecyclingUnit; creditsPerUnit: number; minQuantity: number | null; maxQuantity: number | null;
  isActive: boolean; archived: boolean; timesUsed?: number; createdAt: string; updatedAt: string;
}
export interface AdminRecyclingRequest extends RecyclingRequest {
  customer: { id: string; name: string; email: string; phone: string | null } | null;
  condition: RecyclingCondition | null; adminNotes: string | null; ruleId: string | null; verifiedAt: string | null;
  applicableRules?: RecyclingRule[];
}
export type RecyclingCounts = { total: number } & Record<RecyclingStatus, number>;

// ---------- eco credits ----------
export type EcoCreditType = "RECYCLING_REWARD" | "REDEMPTION" | "MANUAL_CREDIT" | "MANUAL_DEBIT" | "REVERSAL" | "EXPIRATION";
export const ECO_CREDIT_TYPE_LABEL: Record<EcoCreditType, string> = {
  RECYCLING_REWARD: "Recycling reward", REDEMPTION: "Redemption", MANUAL_CREDIT: "Manual credit", MANUAL_DEBIT: "Manual debit",
  REVERSAL: "Reversal", EXPIRATION: "Expiration",
};
export interface EcoTransaction {
  id: string; type: EcoCreditType; amount: number; balanceAfter: number; source: string | null; referenceId: string | null;
  description: string | null; createdAt: string;
}
export type RewardCouponStatus = "active" | "used" | "expired" | "revoked" | "scheduled" | "paused" | "draft";
export interface RewardCoupon {
  id: string; code: string; name: string | null; valueMinor: number; minOrderMinor: number | null; expiresAt: string | null;
  usageLimit: number | null; usageCount: number; status: RewardCouponStatus; createdAt: string;
}
export interface EcoWallet {
  balance: number; transactions: EcoTransaction[]; reward: RewardInfo & { redeemableUnits: number }; coupons: RewardCoupon[];
}
export interface AdminEcoTransaction extends EcoTransaction {
  seq: number; reason: string | null; adminNote: string | null; createdById: string | null;
  customer: { id: string; name: string; email: string } | null;
  request: { id: string; requestNumber: string; material: string | null; unit: RecyclingUnit | null; verifiedQuantity: number | null; creditsPerUnit: number | null } | null;
  coupon: { id: string; code: string; valueMinor: number; used: boolean; revoked: boolean; expiresAt: string | null } | null;
}
export interface EcoDashboard {
  totals: { issued: number; redeemed: number; expired: number; manualDebited: number; outstanding: number };
  requests: { pending: number; approved: number; rejected: number };
  ledger: { reconciled: boolean; mismatchedCustomers: number };
  expiry: { enabled: boolean; days: number | null };
  recent: AdminEcoTransaction[];
}
export interface EcoRewardSettings {
  enabled: boolean; minCreditsToRedeem: number | null; creditsRequired: number | null; couponValueMinor: number | null;
  couponValidityDays: number | null; couponMinOrderMinor: number | null; couponUsageLimit: number; maxUnitsPerRedemption: number;
  allowCombine: boolean; appliesTo: "all" | "products" | "categories"; productIds: string[]; categoryIds: string[];
  products: { id: string; name: string; sku: string }[]; categories: { id: string; name: string }[];
  creditExpiryEnabled: boolean; creditExpiryDays: number | null; ready: boolean; updatedAt: string;
}
export interface ReturnsRecyclingOverview {
  productReturns: { total: number; open: number; refunded: number; rejected: number; byStatus: Record<string, number> };
  recycling: { total: number; open: number; approved: number; rejected: number; byStatus: Record<string, number> };
  rules: { active: number; inactive: number };
  recentRecycling: AdminRecyclingRequest[];
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

/** "8.5" not "8.500"; "10" not "10.00". */
export const fmtQty = (n: number | null | undefined) => (n == null ? "—" : Number(n.toFixed(3)).toLocaleString("en-IN", { maximumFractionDigits: 3 }));

export const recyclingApi = {
  /** Public: accepted materials, live rates and the reward conversion. */
  program: () => request<RecyclingProgram>("/recycling/program", { auth: false }),
  list: () => request<{ requests: RecyclingRequest[] }>("/recycling/requests"),
  create: (body: { material: string; unit: RecyclingUnit; estimatedQuantity: number; description?: string | null; pickupAddressId: string }) =>
    request<RecyclingRequest>("/recycling/requests", { method: "POST", body }),
  cancel: (id: string) => request<RecyclingRequest>(`/recycling/requests/${id}/cancel`, { method: "POST" }),
  attachFile: (id: string, payload: { fileName: string; mime: string; dataBase64: string }) =>
    request<RecyclingFileMeta>(`/recycling/requests/${id}/files`, { method: "POST", body: payload }),
  downloadFile: (id: string, fileId: string) => requestBlob(`/recycling/requests/${id}/files/${fileId}/download`),
};

export const ecoCreditsApi = {
  wallet: () => request<EcoWallet>("/eco-credits"),
  /** Only HOW MANY rewards — the price and value are the server's. */
  redeem: (units = 1) => request<{ coupon: RewardCoupon; creditsSpent: number; balance: number }>("/eco-credits/redeem", { method: "POST", body: { units } }),
};

export const adminRecyclingApi = {
  overview: () => request<ReturnsRecyclingOverview>("/admin/recycling/overview"),
  rules: (includeArchived = false) => request<{ rules: RecyclingRule[] }>(`/admin/recycling/rules${includeArchived ? "?includeArchived=1" : ""}`),
  createRule: (body: { material: string; unit: RecyclingUnit; creditsPerUnit: number; minQuantity?: number | null; maxQuantity?: number | null; isActive?: boolean }) =>
    request<RecyclingRule>("/admin/recycling/rules", { method: "POST", body }),
  updateRule: (id: string, body: Partial<{ material: string; unit: RecyclingUnit; creditsPerUnit: number; minQuantity: number | null; maxQuantity: number | null; isActive: boolean }>) =>
    request<RecyclingRule>(`/admin/recycling/rules/${id}`, { method: "PATCH", body }),
  setRuleActive: (id: string, on: boolean) => request<RecyclingRule>(`/admin/recycling/rules/${id}/${on ? "activate" : "deactivate"}`, { method: "POST" }),
  archiveRule: (id: string) => request<{ id: string }>(`/admin/recycling/rules/${id}`, { method: "DELETE" }),

  requests: (p: { status?: string; material?: string; q?: string } = {}) =>
    request<{ requests: AdminRecyclingRequest[]; total: number; counts: RecyclingCounts }>(`/admin/recycling/requests${qs(p)}`),
  request: (id: string) => request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}`),
  schedulePickup: (id: string, date: string) => request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}/pickup`, { method: "POST", body: { date } }),
  markReceived: (id: string) => request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}/received`, { method: "POST" }),
  /** Saves the verified quantity + rule; the response carries the server's calculation. */
  verify: (id: string, body: { verifiedQuantity: number; ruleId: string; condition?: RecyclingCondition | null; adminNotes?: string | null }) =>
    request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}/verify`, { method: "POST", body }),
  /** `expectedCredits` is a staleness check only — the server recalculates the award. */
  approve: (id: string, expectedCredits: number) => request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}/approve`, { method: "POST", body: { expectedCredits } }),
  reject: (id: string, reason: string) => request<AdminRecyclingRequest>(`/admin/recycling/requests/${id}/reject`, { method: "POST", body: { reason } }),
  downloadFile: (id: string, fileId: string) => requestBlob(`/admin/recycling/requests/${id}/files/${fileId}/download`),
};

export const adminEcoCreditsApi = {
  overview: () => request<EcoDashboard>("/admin/eco-credits/overview"),
  transactions: (p: { customer?: string; userId?: string; type?: string; from?: string; to?: string; material?: string; requestNumber?: string; take?: number; skip?: number } = {}) =>
    request<{ transactions: AdminEcoTransaction[]; total: number }>(`/admin/eco-credits/transactions${qs(p)}`),
  searchCustomers: (q: string) => request<{ customers: { id: string; name: string; email: string; balance: number }[] }>(`/admin/eco-credits/customers${qs({ q })}`),
  customer: (userId: string) => request<{ customer: { id: string; name: string; email: string }; balance: number; transactions: AdminEcoTransaction[]; coupons: RewardCoupon[] }>(`/admin/eco-credits/customers/${userId}`),
  adjust: (body: { userId: string; direction: "credit" | "debit"; amount: number; reason: string; adminNote?: string | null }) =>
    request<{ balance: number }>("/admin/eco-credits/adjustments", { method: "POST", body }),
  revokeCoupon: (couponId: string, reason: string) => request<{ creditsReturned: number; balance: number }>(`/admin/eco-credits/coupons/${couponId}/revoke`, { method: "POST", body: { reason } }),
  runExpiry: () => request<{ customers: number; credits: number }>("/admin/eco-credits/expire", { method: "POST" }),
  settings: () => request<EcoRewardSettings>("/admin/eco-credits/settings"),
  saveSettings: (body: Partial<Omit<EcoRewardSettings, "products" | "categories" | "ready" | "updatedAt">>) =>
    request<EcoRewardSettings>("/admin/eco-credits/settings", { method: "PUT", body }),
};
