// Typed client for admin settings (payment methods, notifications) and
// payment requests. Every write goes through the authenticated request()
// helper; the public /pay/:token page uses `auth: false` so a customer who is
// not signed in can still open the link they were sent.
import { request } from "./client";

// ---------- Payment methods ----------
export type PaymentMethodKey = "cod" | "upi" | "bank_transfer" | "neft" | "cheque";

export interface PaymentMethodConfig {
  minOrderMinor?: number | null;
  maxOrderMinor?: number | null;
  codChargeMinor?: number;
  upiId?: string;
  qrUrl?: string | null;
  accountName?: string;
  bankName?: string;
  accountNumber?: string;
  ifsc?: string;
  instructions?: string;
}

export interface PaymentMethodSetting {
  key: PaymentMethodKey;
  enabled: boolean;
  displayName: string;
  description: string;
  sortOrder: number;
  config: PaymentMethodConfig;
  updatedAt?: string;
}

/** Customer-facing method (enabled only, safe config). */
export interface PublicPaymentMethod {
  key: PaymentMethodKey;
  displayName: string;
  description: string;
  sortOrder: number;
  config: PaymentMethodConfig;
}

export const paymentSettingsApi = {
  list: () => request<{ methods: PaymentMethodSetting[] }>("/admin/settings/payments"),
  update: (key: PaymentMethodKey, input: Partial<Pick<PaymentMethodSetting, "enabled" | "displayName" | "description" | "sortOrder">> & { config?: PaymentMethodConfig }) =>
    request<PaymentMethodSetting>(`/admin/settings/payments/${key}`, { method: "PUT", body: input }),
  uploadQr: (name: string, mime: string, dataBase64: string) =>
    request<PaymentMethodSetting>("/admin/settings/payments/upi/qr", { method: "POST", body: { name, mime, dataBase64 } }),
  removeQr: () => request<PaymentMethodSetting>("/admin/settings/payments/upi/qr", { method: "DELETE" }),
};

export const checkoutMethodsApi = {
  list: () => request<{ methods: PublicPaymentMethod[] }>("/checkout/payment-methods"),
};

// ---------- Notification settings ----------
export interface NotificationEventDef { key: string; label: string; mandatory: boolean }
export interface ChannelMatrix { email: boolean; whatsapp: boolean; sms: boolean; inApp: boolean }

export interface NotificationSettings {
  channels: { emailEnabled: boolean; whatsappEnabled: boolean; smsEnabled: boolean; inAppEnabled: boolean };
  eventMatrix: Record<string, Partial<ChannelMatrix>>;
  effectiveMatrix: Record<string, ChannelMatrix>;
  events: NotificationEventDef[];
  email: {
    host: string; port: number; secure: boolean; user: string; passwordSet: boolean;
    fromEmail: string; fromName: string; replyTo: string; configured: boolean; source: "database" | "environment" | "none";
  };
  whatsapp: {
    provider: string; phoneNumberId: string; accessTokenSet: boolean; businessNumber: string;
    configured: boolean; source: "database" | "environment" | "none";
  };
  sms: { configured: boolean; provider: string };
  updatedAt: string;
}

export interface DeliveryResult { status: "SENT" | "FAILED" | "SKIPPED"; error?: string | null; providerMessageId?: string | null; deliveryId?: string | null }

export interface DeliveryRow {
  id: string; channel: string; provider: string; recipient: string; messageType: string; subject: string | null;
  status: string; error: string | null; providerMessageId: string | null; sentAt: string | null; failedAt: string | null;
  createdAt: string; entityType: string | null; entityId: string | null;
  customer: { id: string; email: string; name: string } | null;
}

export const notificationSettingsApi = {
  get: () => request<NotificationSettings>("/admin/settings/notifications"),
  updateChannels: (input: Partial<NotificationSettings["channels"]> & { eventMatrix?: Record<string, Partial<ChannelMatrix>> }) =>
    request<NotificationSettings>("/admin/settings/notifications", { method: "PUT", body: input }),
  updateEmail: (input: { host: string; port: number; secure: boolean; user: string; password?: string; clearPassword?: boolean; fromEmail: string; fromName?: string; replyTo?: string; emailEnabled?: boolean }) =>
    request<Omit<NotificationSettings, "events" | "effectiveMatrix">>("/admin/settings/notifications/email", { method: "PUT", body: input }),
  testEmail: (to: string) => request<DeliveryResult>("/admin/settings/notifications/email/test", { method: "POST", body: { to } }),
  updateWhatsApp: (input: { provider: "meta" | ""; phoneNumberId?: string; accessToken?: string; clearAccessToken?: boolean; businessNumber?: string; whatsappEnabled?: boolean }) =>
    request<Omit<NotificationSettings, "events" | "effectiveMatrix">>("/admin/settings/notifications/whatsapp", { method: "PUT", body: input }),
  testWhatsApp: (to: string) => request<DeliveryResult>("/admin/settings/notifications/whatsapp/test", { method: "POST", body: { to } }),
  deliveries: (params: { channel?: string; status?: string; take?: number; skip?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.channel) qs.set("channel", params.channel);
    if (params.status) qs.set("status", params.status);
    if (params.take) qs.set("take", String(params.take));
    if (params.skip) qs.set("skip", String(params.skip));
    const s = qs.toString();
    return request<{ deliveries: DeliveryRow[]; total: number }>(`/admin/settings/notifications/deliveries${s ? `?${s}` : ""}`);
  },
};

// ---------- Payment requests ----------
export type PaymentRequestStatus = "PENDING" | "SENT" | "SUBMITTED" | "PAID" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface PaymentRequest {
  id: string;
  requestNumber: string;
  status: PaymentRequestStatus;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  allowedMethods: PaymentMethodKey[];
  expiresAt: string | null;
  sentAt: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  proof: { method: string | null; reference: string | null; note: string | null; fileName: string | null; hasFile: boolean } | null;
  order: { id: string; orderNumber: string; grandTotalMinor: number; paymentStatus: string } | null;
  quotation: { id: string; quotationNumber: string } | null;
  customer: { id: string; name: string; email: string; phone: string | null } | null;
  payment: { id: string; paymentNumber: string; status: string; reference: string | null } | null;
  createdAt: string;
  updatedAt: string;
  /** Present for the admin and the owning customer only. */
  payUrl?: string;
}

/** What the public /pay/:token page receives. */
export interface PublicPaymentRequest extends Omit<PaymentRequest, "customer" | "payUrl"> {
  customer: { firstName: string | null; email: string } | null;
  methods: PublicPaymentMethod[];
  canSubmit: boolean;
}

export interface CreatePaymentRequestInput {
  userId: string;
  amountMinor: number;
  title: string;
  description?: string | null;
  orderId?: string | null;
  quotationId?: string | null;
  expiresAt?: string | null;
  allowedMethods?: PaymentMethodKey[];
  send?: boolean;
}

export const paymentRequestsApi = {
  list: (params: { status?: string; userId?: string; orderId?: string; take?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.userId) qs.set("userId", params.userId);
    if (params.orderId) qs.set("orderId", params.orderId);
    if (params.take) qs.set("take", String(params.take));
    const s = qs.toString();
    return request<{ requests: PaymentRequest[]; total: number }>(`/admin/payment-requests${s ? `?${s}` : ""}`);
  },
  create: (input: CreatePaymentRequestInput) => request<PaymentRequest>("/admin/payment-requests", { method: "POST", body: input }),
  approve: (id: string, input: { reference?: string; note?: string } = {}) => request<PaymentRequest>(`/admin/payment-requests/${id}/approve`, { method: "POST", body: input }),
  reject: (id: string, note: string) => request<PaymentRequest>(`/admin/payment-requests/${id}/reject`, { method: "POST", body: { note } }),
  cancel: (id: string) => request<PaymentRequest>(`/admin/payment-requests/${id}/cancel`, { method: "POST" }),
  resend: (id: string) => request<PaymentRequest>(`/admin/payment-requests/${id}/resend`, { method: "POST" }),
  /** Admin-only proof bytes — fetched with the bearer token, never a public URL. */
  proofBlobUrl: async (id: string): Promise<string> => {
    const { API_BASE } = await import("./client");
    const token = localStorage.getItem("zolo.store.accessToken");
    const res = await fetch(`${API_BASE}/admin/payment-requests/${id}/proof`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("Could not load the proof file");
    return URL.createObjectURL(await res.blob());
  },
  /** The signed-in customer's own requests. */
  mine: (orderId?: string) => request<{ requests: PaymentRequest[] }>(`/me/payment-requests${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ""}`),
  /** Public, token-only. */
  byToken: (token: string) => request<PublicPaymentRequest>(`/public/pay/${encodeURIComponent(token)}`, { auth: false }),
  submit: (token: string, input: { method: PaymentMethodKey; reference?: string; note?: string; proof?: { name: string; mime: string; dataBase64: string } | null }) =>
    request<PublicPaymentRequest>(`/public/pay/${encodeURIComponent(token)}/submit`, { method: "POST", body: input, auth: false }),
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: "Cash on Delivery",
  upi: "UPI / QR",
  bank_transfer: "Bank transfer",
  neft: "NEFT",
  cheque: "Cheque",
};

export const REQUEST_STATUS_TONE: Record<PaymentRequestStatus, "neutral" | "info" | "warning" | "success" | "danger" | "primary"> = {
  PENDING: "neutral",
  SENT: "info",
  SUBMITTED: "warning",
  PAID: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

/** File → base64 payload the upload endpoints expect. */
export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
