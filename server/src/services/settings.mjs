// Admin-managed system settings: payment methods + notification configuration.
//
// PostgreSQL is the single source of truth (PaymentMethodSetting rows and the
// NotificationSetting singleton). A small in-process cache keeps the hot paths
// (checkout, notification dispatch) cheap; every write invalidates it so the
// customer-facing side always sees the latest setting immediately.
//
// SECURITY: SMTP password / WhatsApp token are encrypted at rest with
// lib/crypto encryptField (AES-256-GCM) and are NEVER returned by any API — the
// admin shape only says whether a secret is set. Every change is audited.
import { z } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { encryptField, decryptField } from "../lib/crypto.mjs";
import { recordEvent } from "./events.mjs";

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export const PAYMENT_METHOD_KEYS = ["cod", "upi", "bank_transfer", "neft", "cheque"];

const DEFAULT_METHODS = {
  cod: {
    displayName: "Cash on Delivery",
    description: "Pay in cash when your order is delivered.",
    sortOrder: 1,
    enabled: true,
    config: { minOrderMinor: null, maxOrderMinor: null, codChargeMinor: 0 },
  },
  upi: {
    displayName: "UPI / QR Payment",
    description: "Scan the QR code or pay to our UPI ID, then share the transaction reference.",
    sortOrder: 2,
    enabled: false,
    config: { upiId: "", qrUrl: null, accountName: "", instructions: "" },
  },
  bank_transfer: {
    displayName: "Bank Transfer",
    description: "Transfer to our bank account (NEFT/IMPS/RTGS) and share the UTR.",
    sortOrder: 3,
    enabled: true,
    config: { accountName: "", bankName: "", accountNumber: "", ifsc: "", instructions: "" },
  },
  neft: {
    displayName: "NEFT",
    description: "Pay by NEFT; your order is confirmed once the transfer is received.",
    sortOrder: 4,
    enabled: true,
    config: {},
  },
  cheque: {
    displayName: "Cheque",
    description: "Pay by cheque; your order is confirmed once it clears.",
    sortOrder: 5,
    enabled: true,
    config: {},
  },
};

const CACHE_TTL_MS = 30_000;
let methodsCache = null;
let methodsCacheAt = 0;
const invalidateMethods = () => { methodsCache = null; methodsCacheAt = 0; };

/** Make sure every known method has a row (idempotent, additive). */
async function ensurePaymentMethods() {
  const existing = await prisma.paymentMethodSetting.findMany({ select: { key: true } });
  const have = new Set(existing.map((m) => m.key));
  const missing = PAYMENT_METHOD_KEYS.filter((k) => !have.has(k));
  for (const key of missing) {
    const d = DEFAULT_METHODS[key];
    await prisma.paymentMethodSetting.upsert({
      where: { key },
      update: {},
      create: { key, enabled: d.enabled, displayName: d.displayName, description: d.description, sortOrder: d.sortOrder, config: d.config },
    });
  }
}

const shapeMethod = (m) => ({
  key: m.key,
  enabled: m.enabled,
  displayName: m.displayName,
  description: m.description ?? "",
  sortOrder: m.sortOrder,
  config: { ...(DEFAULT_METHODS[m.key]?.config ?? {}), ...(m.config && typeof m.config === "object" ? m.config : {}) },
  updatedAt: m.updatedAt,
});

/** All methods (admin view), ordered. */
export async function listPaymentMethods() {
  const now = Date.now();
  if (methodsCache && now - methodsCacheAt < CACHE_TTL_MS) return methodsCache;
  await ensurePaymentMethods();
  const rows = await prisma.paymentMethodSetting.findMany({ orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
  methodsCache = rows.map(shapeMethod);
  methodsCacheAt = now;
  return methodsCache;
}

export async function getPaymentMethod(key) {
  const all = await listPaymentMethods();
  return all.find((m) => m.key === key) ?? null;
}

/** Enabled methods with only customer-safe config (used by checkout + pay page). */
export async function publicPaymentMethods() {
  const all = await listPaymentMethods();
  return all
    .filter((m) => m.enabled)
    .map((m) => ({
      key: m.key,
      displayName: m.displayName,
      description: m.description,
      sortOrder: m.sortOrder,
      config: publicConfig(m.key, m.config),
    }));
}

function publicConfig(key, config) {
  switch (key) {
    case "cod":
      return { minOrderMinor: config.minOrderMinor ?? null, maxOrderMinor: config.maxOrderMinor ?? null, codChargeMinor: config.codChargeMinor ?? 0 };
    case "upi":
      return { upiId: config.upiId ?? "", qrUrl: config.qrUrl ?? null, accountName: config.accountName ?? "", instructions: config.instructions ?? "" };
    case "bank_transfer":
      return { accountName: config.accountName ?? "", bankName: config.bankName ?? "", accountNumber: config.accountNumber ?? "", ifsc: config.ifsc ?? "", instructions: config.instructions ?? "" };
    default:
      return {};
  }
}

const money = z.number().int().min(0).max(1_000_000_000).nullable().optional();
const METHOD_CONFIG_SCHEMAS = {
  cod: z.object({ minOrderMinor: money, maxOrderMinor: money, codChargeMinor: z.number().int().min(0).max(100_000_00).optional() }).partial(),
  upi: z.object({
    upiId: z.string().trim().max(120).optional(),
    accountName: z.string().trim().max(120).optional(),
    instructions: z.string().trim().max(1000).optional(),
    // qrUrl is only writable through the QR upload endpoint.
  }).partial(),
  bank_transfer: z.object({
    accountName: z.string().trim().max(120).optional(),
    bankName: z.string().trim().max(120).optional(),
    accountNumber: z.string().trim().max(40).optional(),
    ifsc: z.string().trim().max(20).optional(),
    instructions: z.string().trim().max(1000).optional(),
  }).partial(),
  neft: z.object({ instructions: z.string().trim().max(1000).optional() }).partial(),
  cheque: z.object({ instructions: z.string().trim().max(1000).optional() }).partial(),
};

const methodUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Admin updates one method. Audited; config validated per method. */
export async function updatePaymentMethod(adminId, key, input) {
  if (!PAYMENT_METHOD_KEYS.includes(key)) throw notFound("Unknown payment method");
  const parsed = methodUpdateSchema.parse(input ?? {});
  await ensurePaymentMethods();
  const row = await prisma.paymentMethodSetting.findUnique({ where: { key } });
  if (!row) throw notFound("Unknown payment method");

  const data = {};
  if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
  if (parsed.displayName !== undefined) data.displayName = parsed.displayName;
  if (parsed.description !== undefined) data.description = parsed.description || null;
  if (parsed.sortOrder !== undefined) data.sortOrder = parsed.sortOrder;
  if (parsed.config !== undefined) {
    const cfg = METHOD_CONFIG_SCHEMAS[key].parse(parsed.config);
    if (key === "cod" && cfg.minOrderMinor != null && cfg.maxOrderMinor != null && cfg.minOrderMinor > cfg.maxOrderMinor) {
      throw badRequest("COD minimum order amount cannot exceed the maximum", "COD_RANGE");
    }
    // Merge so partial updates never wipe the QR url or other keys.
    data.config = { ...(row.config && typeof row.config === "object" ? row.config : {}), ...cfg };
  }
  data.updatedById = adminId;

  const updated = await prisma.paymentMethodSetting.update({ where: { key }, data });
  invalidateMethods();

  if (parsed.enabled !== undefined && parsed.enabled !== row.enabled) {
    await recordEvent({
      eventType: parsed.enabled ? "payment_method.enabled" : "payment_method.disabled",
      actorId: adminId, entityType: "PaymentMethodSetting", entityId: updated.id,
      metadata: { method: key },
    });
  }
  const otherKeys = Object.keys(data).filter((k) => !["enabled", "updatedById"].includes(k));
  if (otherKeys.length) {
    await recordEvent({
      eventType: "payment_method.updated",
      actorId: adminId, entityType: "PaymentMethodSetting", entityId: updated.id,
      metadata: { method: key, fields: otherKeys },
    });
  }
  return shapeMethod(updated);
}

/** Upload/replace the UPI QR image (public asset). Old file removed. */
export async function setUpiQr(adminId, { name, mime, dataBase64 }) {
  await ensurePaymentMethods();
  const row = await prisma.paymentMethodSetting.findUnique({ where: { key: "upi" } });
  const { storeImage } = await import("./catalog.mjs");
  const url = storeImage({ name: name || "upi-qr", mime, dataBase64 });
  const prev = row?.config?.qrUrl ?? null;
  const updated = await prisma.paymentMethodSetting.update({
    where: { key: "upi" },
    data: { config: { ...(row?.config ?? {}), qrUrl: url }, updatedById: adminId },
  });
  invalidateMethods();
  await removePublicFile(prev);
  await recordEvent({ eventType: "payment_settings.qr_updated", actorId: adminId, entityType: "PaymentMethodSetting", entityId: updated.id, metadata: { method: "upi", action: prev ? "replaced" : "uploaded" } });
  return shapeMethod(updated);
}

export async function removeUpiQr(adminId) {
  await ensurePaymentMethods();
  const row = await prisma.paymentMethodSetting.findUnique({ where: { key: "upi" } });
  const prev = row?.config?.qrUrl ?? null;
  const updated = await prisma.paymentMethodSetting.update({
    where: { key: "upi" },
    data: { config: { ...(row?.config ?? {}), qrUrl: null }, updatedById: adminId },
  });
  invalidateMethods();
  await removePublicFile(prev);
  await recordEvent({ eventType: "payment_settings.qr_updated", actorId: adminId, entityType: "PaymentMethodSetting", entityId: updated.id, metadata: { method: "upi", action: "removed" } });
  return shapeMethod(updated);
}

async function removePublicFile(url) {
  if (!url) return;
  try {
    const { remove } = await import("../lib/storage.mjs");
    const key = String(url).split("/").pop();
    if (key) remove(key);
  } catch { /* best-effort */ }
}

/**
 * Validate a chosen checkout method against the admin settings. Returns the
 * method row (with config) or throws a 400 the checkout can surface.
 */
export async function assertMethodAllowed(key, { subtotalMinor = 0 } = {}) {
  const m = await getPaymentMethod(key);
  if (!m || !m.enabled) throw badRequest("That payment method is not available right now", "PAYMENT_METHOD_DISABLED");
  if (key === "cod") {
    const { minOrderMinor, maxOrderMinor } = m.config;
    if (minOrderMinor != null && subtotalMinor < minOrderMinor) {
      throw badRequest(`Cash on Delivery is available for orders of ₹${(minOrderMinor / 100).toLocaleString("en-IN")} or more`, "COD_MIN_ORDER");
    }
    if (maxOrderMinor != null && subtotalMinor > maxOrderMinor) {
      throw badRequest(`Cash on Delivery is available for orders up to ₹${(maxOrderMinor / 100).toLocaleString("en-IN")}`, "COD_MAX_ORDER");
    }
  }
  return m;
}

/** COD surcharge (paise) for a given method, 0 for everything else. */
export async function codChargeFor(key) {
  if (key !== "cod") return 0;
  const m = await getPaymentMethod("cod");
  return m?.enabled ? Number(m.config.codChargeMinor ?? 0) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Notification settings (singleton)
// ---------------------------------------------------------------------------

let notifCache = null;
let notifCacheAt = 0;
const invalidateNotif = () => { notifCache = null; notifCacheAt = 0; };

async function ensureNotificationRow() {
  return prisma.notificationSetting.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}

const safeDecrypt = (enc) => {
  if (!enc) return "";
  try { return decryptField(enc); } catch { return ""; }
};

/**
 * INTERNAL: full settings with decrypted secrets, for the providers. Env vars
 * act as a fallback when a DB value is empty, so existing .env-based deploys
 * keep working until the admin saves settings in the UI.
 */
export async function getNotificationSettings() {
  const now = Date.now();
  if (notifCache && now - notifCacheAt < CACHE_TTL_MS) return notifCache;
  const row = await ensureNotificationRow();
  const env = process.env;
  const s = {
    emailEnabled: row.emailEnabled,
    whatsappEnabled: row.whatsappEnabled,
    smsEnabled: row.smsEnabled,
    inAppEnabled: row.inAppEnabled,
    eventMatrix: row.eventMatrix && typeof row.eventMatrix === "object" ? row.eventMatrix : {},
    email: {
      host: row.smtpHost || String(env.SMTP_HOST || "").trim(),
      port: row.smtpPort || Number(env.SMTP_PORT || 587),
      secure: row.smtpHost ? row.smtpSecure : String(env.SMTP_SECURE || "").toLowerCase() === "true",
      user: row.smtpUser || String(env.SMTP_USER || "").trim(),
      pass: row.smtpHost ? safeDecrypt(row.smtpPassEnc) : String(env.SMTP_PASS || "").trim(),
      fromEmail: row.fromEmail || parseFrom(env.EMAIL_FROM).email || "no-reply@zolopackaging.com",
      fromName: row.fromName || parseFrom(env.EMAIL_FROM).name || "Zolo Packaging",
      replyTo: row.replyTo || "",
      adminEmail: String(env.ADMIN_EMAIL || "").trim(),
    },
    whatsapp: {
      provider: row.whatsappProvider || String(env.WHATSAPP_PROVIDER || "").trim().toLowerCase(),
      phoneNumberId: row.whatsappPhoneNumberId || String(env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
      accessToken: row.whatsappPhoneNumberId ? safeDecrypt(row.whatsappAccessTokenEnc) : String(env.WHATSAPP_ACCESS_TOKEN || "").trim(),
      businessNumber: row.whatsappBusinessNumber || String(env.OWNER_WHATSAPP_NUMBER || "").replace(/[^\d]/g, ""),
    },
    publicBaseUrl: String(env.PUBLIC_BASE_URL || env.APP_URL || env.ADMIN_BASE_URL || "http://localhost:5173").trim().replace(/\/$/, ""),
    updatedAt: row.updatedAt,
  };
  notifCache = s;
  notifCacheAt = now;
  return s;
}

function parseFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim() };
  return { name: "", email: s };
}

export const isEmailConfigured = (s) => Boolean(s.email.host && s.email.user && s.email.pass);
export const isWhatsAppConfigured = (s) => s.whatsapp.provider === "meta" && Boolean(s.whatsapp.accessToken && s.whatsapp.phoneNumberId);

/** Admin-facing shape: secrets replaced by "is set" booleans. */
export async function getNotificationSettingsForAdmin() {
  const s = await getNotificationSettings();
  const row = await ensureNotificationRow();
  return {
    channels: { emailEnabled: s.emailEnabled, whatsappEnabled: s.whatsappEnabled, smsEnabled: s.smsEnabled, inAppEnabled: s.inAppEnabled },
    eventMatrix: s.eventMatrix,
    email: {
      host: row.smtpHost ?? "", port: row.smtpPort ?? 587, secure: row.smtpSecure, user: row.smtpUser ?? "",
      passwordSet: Boolean(row.smtpPassEnc), fromEmail: row.fromEmail ?? "", fromName: row.fromName ?? "", replyTo: row.replyTo ?? "",
      configured: isEmailConfigured(s),
      source: row.smtpHost ? "database" : (s.email.host ? "environment" : "none"),
    },
    whatsapp: {
      provider: row.whatsappProvider ?? "", phoneNumberId: row.whatsappPhoneNumberId ?? "",
      accessTokenSet: Boolean(row.whatsappAccessTokenEnc), businessNumber: row.whatsappBusinessNumber ?? "",
      configured: isWhatsAppConfigured(s),
      source: row.whatsappPhoneNumberId ? "database" : (s.whatsapp.phoneNumberId ? "environment" : "none"),
    },
    sms: { configured: false, provider: "none" },
    updatedAt: row.updatedAt,
  };
}

const channelsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  eventMatrix: z.record(
    z.string().max(60),
    z.object({ email: z.boolean().optional(), whatsapp: z.boolean().optional(), sms: z.boolean().optional(), inApp: z.boolean().optional() }),
  ).optional(),
});

export async function updateNotificationChannels(adminId, input) {
  const p = channelsSchema.parse(input ?? {});
  await ensureNotificationRow();
  const data = { updatedById: adminId };
  for (const k of ["emailEnabled", "whatsappEnabled", "smsEnabled", "inAppEnabled"]) if (p[k] !== undefined) data[k] = p[k];
  if (p.eventMatrix !== undefined) data.eventMatrix = p.eventMatrix;
  await prisma.notificationSetting.update({ where: { id: "default" }, data });
  invalidateNotif();
  await recordEvent({ eventType: "settings.notifications.updated", actorId: adminId, entityType: "NotificationSetting", entityId: "default", metadata: { fields: Object.keys(data).filter((k) => k !== "updatedById") } });
  return getNotificationSettingsForAdmin();
}

const emailSchema = z.object({
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().trim().max(200),
  // Omit/empty = keep the stored password; provide to replace; clearPassword to remove.
  password: z.string().max(500).optional(),
  clearPassword: z.boolean().optional(),
  fromEmail: z.union([z.string().trim().email().max(200), z.literal("")]).optional().nullable(),
  fromName: z.string().trim().max(120).optional().nullable(),
  replyTo: z.union([z.string().trim().email().max(200), z.literal(""), z.null()]).optional(),
  emailEnabled: z.boolean().optional(),
});

export async function updateEmailSettings(adminId, input) {
  const p = emailSchema.parse(input ?? {});
  const row = await ensureNotificationRow();
  const data = {
    smtpHost: p.host || null, smtpPort: p.port, smtpSecure: p.secure, smtpUser: p.user || null,
    fromEmail: p.fromEmail || null, fromName: p.fromName || null, replyTo: p.replyTo || null, updatedById: adminId,
  };
  if (p.clearPassword) data.smtpPassEnc = null;
  else if (p.password) data.smtpPassEnc = encryptField(p.password);
  if (p.emailEnabled !== undefined) data.emailEnabled = p.emailEnabled;
  await prisma.notificationSetting.update({ where: { id: "default" }, data });
  invalidateNotif();
  await recordEvent({
    eventType: "settings.smtp.updated", actorId: adminId, entityType: "NotificationSetting", entityId: "default",
    // Never log the password — only whether it changed.
    metadata: { host: p.host, port: p.port, secure: p.secure, user: p.user, passwordChanged: Boolean(p.password || p.clearPassword), hadPassword: Boolean(row.smtpPassEnc) },
  });
  return getNotificationSettingsForAdmin();
}

const whatsappSchema = z.object({
  provider: z.enum(["meta", ""]).default(""),
  phoneNumberId: z.string().trim().max(60).optional().nullable(),
  accessToken: z.string().max(1000).optional(),
  clearAccessToken: z.boolean().optional(),
  businessNumber: z.string().trim().max(20).optional().nullable(),
  whatsappEnabled: z.boolean().optional(),
});

export async function updateWhatsAppSettings(adminId, input) {
  const p = whatsappSchema.parse(input ?? {});
  await ensureNotificationRow();
  const data = {
    whatsappProvider: p.provider || null,
    whatsappPhoneNumberId: p.phoneNumberId || null,
    whatsappBusinessNumber: p.businessNumber ? String(p.businessNumber).replace(/[^\d]/g, "") : null,
    updatedById: adminId,
  };
  if (p.clearAccessToken) data.whatsappAccessTokenEnc = null;
  else if (p.accessToken) data.whatsappAccessTokenEnc = encryptField(p.accessToken);
  if (p.whatsappEnabled !== undefined) data.whatsappEnabled = p.whatsappEnabled;
  await prisma.notificationSetting.update({ where: { id: "default" }, data });
  invalidateNotif();
  await recordEvent({
    eventType: "settings.whatsapp.updated", actorId: adminId, entityType: "NotificationSetting", entityId: "default",
    metadata: { provider: p.provider || null, phoneNumberId: p.phoneNumberId || null, tokenChanged: Boolean(p.accessToken || p.clearAccessToken) },
  });
  return getNotificationSettingsForAdmin();
}

/** Delivery history for the admin (paginated, newest first). */
export async function listDeliveries({ channel = null, status = null, take = 50, skip = 0 } = {}) {
  const where = { ...(channel ? { channel } : {}), ...(status ? { status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(take) || 50, 1), 200), skip: Math.max(Number(skip) || 0, 0),
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }),
    prisma.notificationDelivery.count({ where }),
  ]);
  return {
    deliveries: rows.map((d) => ({
      id: d.id, channel: d.channel, provider: d.provider, recipient: d.recipient, messageType: d.messageType,
      subject: d.subject, status: d.status, error: d.error, providerMessageId: d.providerMessageId,
      sentAt: d.sentAt, failedAt: d.failedAt, createdAt: d.createdAt, entityType: d.entityType, entityId: d.entityId,
      customer: d.user ? { id: d.user.id, email: d.user.email, name: [d.user.firstName, d.user.lastName].filter(Boolean).join(" ") } : null,
    })),
    total,
  };
}

// Test hooks: make providers re-read settings (they cache transports by config).
export function _invalidateAllSettingsCaches() { invalidateMethods(); invalidateNotif(); }
