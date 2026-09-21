// Typed client for the Marketing module: coupons + campaigns.
//
// Admin calls go through the authenticated request() helper. The storefront
// reads live campaigns from the PUBLIC /campaigns/active endpoint (`auth:
// false`), which only ever returns campaigns the server judged live.
import { request } from "./client";

// ---------- Coupons ----------
export type CouponStatus = "draft" | "scheduled" | "active" | "paused" | "expired" | "usage_limit_reached";
export type CouponScope = "all" | "products" | "categories";

export interface AdminCoupon {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  discountType: "percent" | "flat";
  /** percent → basis points (1000 = 10%); flat → paise */
  discountValue: number;
  maxDiscountMinor: number | null;
  minOrderMinor: number | null;
  usageLimit: number | null;
  usageCount: number;
  usageLimitPerCustomer: number | null;
  startAt: string | null;
  endAt: string | null;
  isActive: boolean;
  isDraft: boolean;
  appliesTo: CouponScope;
  allowSaleItems: boolean;
  allowOtherDiscounts: boolean;
  products: { id: string; name: string; sku: string }[];
  categories: { id: string; name: string; parentId: string | null }[];
  redemptions: number;
  /** Derived by the server from dates + isActive + usage — never set by hand. */
  status: CouponStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CouponInput {
  code: string;
  name?: string | null;
  description?: string | null;
  discountType: "percent" | "flat";
  discountValue: number;
  maxDiscountMinor?: number | null;
  minOrderMinor?: number | null;
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  startAt: string;
  endAt: string;
  isActive?: boolean;
  isDraft?: boolean;
  appliesTo?: CouponScope;
  productIds?: string[];
  categoryIds?: string[];
  allowSaleItems?: boolean;
  allowOtherDiscounts?: boolean;
}

export type StatusCounts<S extends string> = { total: number } & Record<S, number>;

// ---------- Campaigns ----------
export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "expired";
export type CampaignContentType = "text" | "image" | "quote" | "text_image" | "promo_card";
export type CampaignPlacement =
  | "announcement_bar" | "homepage_hero" | "homepage_promo_card" | "homepage_popup"
  | "product_listing" | "product_detail" | "cart" | "checkout";
export type CampaignCtaType = "none" | "product" | "category" | "shop" | "cart" | "external";
export type PopupPosition = "center" | "bottom_right" | "bottom_left";
export type PopupFrequency = "every_visit" | "once_per_session" | "once_per_day" | "once_per_campaign" | "always";

export interface PopupSettings {
  position: PopupPosition;
  frequency: PopupFrequency;
  delaySeconds: number;
  allowClose: boolean;
  overlay: boolean;
}

/** What the storefront receives. Every text value is plain text. */
export interface PublicCampaign {
  id: string;
  contentType: CampaignContentType;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  quote: string | null;
  quoteAuthor: string | null;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  imageAlt: string | null;
  badgeText: string | null;
  buttonText: string | null;
  /** Resolved by the server from the typed CTA target. */
  buttonLink: string | null;
  buttonExternal: boolean;
  placements: CampaignPlacement[];
  priority: number;
  startAt: string;
  endAt: string;
  popup: PopupSettings;
}

export interface AdminCampaign extends PublicCampaign {
  name: string;
  ctaType: CampaignCtaType;
  ctaProductId: string | null;
  ctaCategoryId: string | null;
  ctaUrl: string | null;
  ctaProduct: { id: string; name: string } | null;
  ctaCategory: { id: string; name: string } | null;
  isActive: boolean;
  isDraft: boolean;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignInput {
  name: string;
  contentType: CampaignContentType;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  quote?: string | null;
  quoteAuthor?: string | null;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  badgeText?: string | null;
  buttonText?: string | null;
  ctaType?: CampaignCtaType;
  ctaProductId?: string | null;
  ctaCategoryId?: string | null;
  ctaUrl?: string | null;
  placements: CampaignPlacement[];
  startAt: string;
  endAt: string;
  isActive?: boolean;
  isDraft?: boolean;
  priority?: number;
  popupPosition?: PopupPosition;
  popupFrequency?: PopupFrequency;
  popupDelaySeconds?: number;
  popupAllowClose?: boolean;
  popupOverlay?: boolean;
}

export interface MarketingOverview {
  coupons: { counts: StatusCounts<CouponStatus>; recent: AdminCoupon[] };
  campaigns: { counts: StatusCounts<CampaignStatus>; recent: AdminCampaign[] };
}

export interface CouponValidation {
  valid: boolean;
  code: string | null;
  name?: string | null;
  discountMinor: number;
  subtotalMinor?: number;
  grandTotalMinor?: number;
  message: string | null;
}

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};

export const marketingApi = {
  overview: () => request<MarketingOverview>("/admin/marketing"),

  listCoupons: (p: { status?: string; search?: string } = {}) =>
    request<{ coupons: AdminCoupon[]; counts: StatusCounts<CouponStatus> }>(`/admin/coupons${qs(p)}`),
  createCoupon: (body: CouponInput) => request<AdminCoupon>("/admin/coupons", { method: "POST", body }),
  updateCoupon: (id: string, body: Partial<CouponInput>) => request<AdminCoupon>(`/admin/coupons/${id}`, { method: "PATCH", body }),
  archiveCoupon: (id: string) => request<{ id: string }>(`/admin/coupons/${id}`, { method: "DELETE" }),

  listCampaigns: (p: { status?: string; search?: string } = {}) =>
    request<{ campaigns: AdminCampaign[]; counts: StatusCounts<CampaignStatus> }>(`/admin/campaigns${qs(p)}`),
  createCampaign: (body: CampaignInput) => request<AdminCampaign>("/admin/campaigns", { method: "POST", body }),
  updateCampaign: (id: string, body: Partial<CampaignInput>) => request<AdminCampaign>(`/admin/campaigns/${id}`, { method: "PATCH", body }),
  archiveCampaign: (id: string) => request<{ id: string }>(`/admin/campaigns/${id}`, { method: "DELETE" }),

  /** Storefront: live campaigns (all placements in one call). Public. */
  activeCampaigns: () => request<{ campaigns: PublicCampaign[]; serverTime: string }>("/campaigns/active", { auth: false }),

  /** Buyer: is this code valid for MY cart? The server computes the discount. */
  validateCoupon: (code: string) => request<CouponValidation>("/coupons/validate", { method: "POST", body: { code } }),
};
