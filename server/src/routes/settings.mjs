// Admin settings routes: /api/v1/admin/settings/*  (authenticate + requireAdmin
// are applied at mount time in app.mjs). Secrets are never echoed back.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as settings from "../services/settings.mjs";
import { NOTIFICATION_EVENTS, effectiveMatrix } from "../services/notification-service.mjs";

export const adminSettingsRouter = Router();

// ---- Payments -----------------------------------------------------------
adminSettingsRouter.get("/payments", wrap(async (_req, res) => ok(res, { methods: await settings.listPaymentMethods() })));

adminSettingsRouter.put("/payments/:key", wrap(async (req, res) => {
  ok(res, await settings.updatePaymentMethod(req.user.id, req.params.key, req.body ?? {}));
}));

adminSettingsRouter.post("/payments/upi/qr", wrap(async (req, res) => {
  const { name, mime, dataBase64 } = req.body ?? {};
  ok(res, await settings.setUpiQr(req.user.id, { name, mime, dataBase64 }), 201);
}));

adminSettingsRouter.delete("/payments/upi/qr", wrap(async (req, res) => ok(res, await settings.removeUpiQr(req.user.id))));

// ---- Notifications ------------------------------------------------------
adminSettingsRouter.get("/notifications", wrap(async (_req, res) => {
  const s = await settings.getNotificationSettingsForAdmin();
  ok(res, { ...s, events: NOTIFICATION_EVENTS, effectiveMatrix: effectiveMatrix(s.eventMatrix) });
}));

adminSettingsRouter.put("/notifications", wrap(async (req, res) => {
  const s = await settings.updateNotificationChannels(req.user.id, req.body ?? {});
  ok(res, { ...s, events: NOTIFICATION_EVENTS, effectiveMatrix: effectiveMatrix(s.eventMatrix) });
}));

adminSettingsRouter.put("/notifications/email", wrap(async (req, res) => ok(res, await settings.updateEmailSettings(req.user.id, req.body ?? {}))));

adminSettingsRouter.post("/notifications/email/test", wrap(async (req, res) => {
  const to = String(req.body?.to ?? "").trim() || req.user.email;
  const { sendTestEmail } = await import("../services/email.mjs");
  ok(res, await sendTestEmail(to, { actorId: req.user.id }));
}));

adminSettingsRouter.put("/notifications/whatsapp", wrap(async (req, res) => ok(res, await settings.updateWhatsAppSettings(req.user.id, req.body ?? {}))));

adminSettingsRouter.post("/notifications/whatsapp/test", wrap(async (req, res) => {
  const { sendTestWhatsApp } = await import("../services/whatsapp.mjs");
  const s = await settings.getNotificationSettings();
  const to = String(req.body?.to ?? "").trim() || s.whatsapp.businessNumber;
  ok(res, await sendTestWhatsApp(to, { actorId: req.user.id }));
}));

adminSettingsRouter.get("/notifications/deliveries", wrap(async (req, res) => {
  ok(res, await settings.listDeliveries({ channel: req.query.channel || null, status: req.query.status || null, take: req.query.take, skip: req.query.skip }));
}));
