// Admin settings (payment methods + notifications) and the payment-request
// flow — the REAL chain, PostgreSQL as source of truth:
//
//   admin PUT /admin/settings/payments/:key  → checkout gating + COD charge
//   admin PUT /admin/settings/notifications/* → secrets encrypted, never echoed
//   admin POST /admin/payment-requests → public GET/POST /public/pay/:token
//     → admin approve → Payment PAID → order paidMinor/paymentStatus → audit
//   notification dispatch → NotificationDelivery rows honouring admin + customer prefs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, apiRaw, registerBuyer, adminToken, makeProduct, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { decryptField } from "../src/lib/crypto.mjs";

before(startServer);
after(stopServer);

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function resetMethods(admin) {
  // Back to a known baseline so tests are order-independent.
  await api("/admin/settings/payments/cod", { method: "PUT", token: admin, body: { enabled: true, config: { minOrderMinor: null, maxOrderMinor: null, codChargeMinor: 0 } } });
  await api("/admin/settings/payments/upi", { method: "PUT", token: admin, body: { enabled: true, config: { upiId: "zolo@upi", accountName: "Zolo Packaging" } } });
  await api("/admin/settings/payments/bank_transfer", { method: "PUT", token: admin, body: { enabled: true } });
}

async function placeOrder(buyer, { productPriceMinor = 50000, qty = 2, paymentMethod = "cod" } = {}) {
  const product = await makeProduct({ priceMinor: productPriceMinor, stock: 1000, name: "Settings Box" });
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: qty } });
  const address = await makeAddress(buyer.token);
  return api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: address, paymentMethod, idempotencyKey: `ps-${Math.random()}` } });
}

// ---------------------------------------------------------------------------
// Payment method settings
// ---------------------------------------------------------------------------

test("payment methods are seeded, admin-only, and audited on enable/disable", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  const list = await api("/admin/settings/payments", { token: admin });
  assert.equal(list.status, 200);
  const keys = list.body.data.methods.map((m) => m.key);
  for (const k of ["cod", "upi", "bank_transfer", "neft", "cheque"]) assert.ok(keys.includes(k), `missing ${k}`);

  const buyer = await registerBuyer();
  const denied = await api("/admin/settings/payments", { token: buyer.token });
  assert.equal(denied.status, 403, "customers cannot read admin settings");
  const anon = await api("/admin/settings/payments");
  assert.equal(anon.status, 401);

  const off = await api("/admin/settings/payments/cheque", { method: "PUT", token: admin, body: { enabled: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.enabled, false);
  const audit = await prisma.auditLog.findFirst({ where: { eventType: "payment_method.disabled", metadata: { path: ["method"], equals: "cheque" } }, orderBy: { createdAt: "desc" } });
  assert.ok(audit, "disable is audited");
  const on = await api("/admin/settings/payments/cheque", { method: "PUT", token: admin, body: { enabled: true } });
  assert.equal(on.body.data.enabled, true);

  const unknown = await api("/admin/settings/payments/card", { method: "PUT", token: admin, body: { enabled: true } });
  assert.equal(unknown.status, 404);
});

test("checkout only offers enabled methods and refuses a disabled one", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  await api("/admin/settings/payments/bank_transfer", { method: "PUT", token: admin, body: { enabled: false } });

  const buyer = await registerBuyer();
  const methods = await api("/checkout/payment-methods", { token: buyer.token });
  assert.equal(methods.status, 200);
  const keys = methods.body.data.methods.map((m) => m.key);
  assert.ok(keys.includes("cod"));
  assert.ok(!keys.includes("bank_transfer"), "disabled method must not be offered");

  const placed = await placeOrder(buyer, { paymentMethod: "bank_transfer" });
  assert.equal(placed.status, 400, JSON.stringify(placed.body));
  assert.equal(placed.body.code, "PAYMENT_METHOD_DISABLED");

  await api("/admin/settings/payments/bank_transfer", { method: "PUT", token: admin, body: { enabled: true } });
});

test("COD min/max and charge are enforced server-side and shown in the quote", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  const bad = await api("/admin/settings/payments/cod", { method: "PUT", token: admin, body: { config: { minOrderMinor: 500000, maxOrderMinor: 100000 } } });
  assert.equal(bad.status, 400, "min > max is rejected");

  // Min ₹2,000, max ₹50,000, charge ₹50.
  const ok = await api("/admin/settings/payments/cod", { method: "PUT", token: admin, body: { config: { minOrderMinor: 200000, maxOrderMinor: 5000000, codChargeMinor: 5000 } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.config.codChargeMinor, 5000);

  const buyer = await registerBuyer();
  // ₹1,000 subtotal → below COD minimum.
  const product = await makeProduct({ priceMinor: 50000, stock: 1000, name: "COD Min Box" });
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 2 } });
  const q = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { paymentMethod: "cod" } });
  assert.equal(q.status, 200);
  assert.match(q.body.data.paymentError ?? "", /2,000/);
  assert.equal(q.body.data.codChargeMinor, 0);
  const address = await makeAddress(buyer.token);
  const tooSmall = await api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: address, paymentMethod: "cod", idempotencyKey: `cod-${Math.random()}` } });
  assert.equal(tooSmall.status, 400);
  assert.equal(tooSmall.body.code, "COD_MIN_ORDER");

  // Add more → ₹3,000 subtotal → within range; charge applies to the total.
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 6 } });
  const q2 = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { paymentMethod: "cod" } });
  assert.equal(q2.body.data.paymentError, null);
  assert.equal(q2.body.data.codChargeMinor, 5000);
  const expectedTotal = q2.body.data.subtotalMinor - q2.body.data.discountMinor + q2.body.data.taxMinor + q2.body.data.shippingMinor + 5000;
  assert.equal(q2.body.data.grandTotalMinor, expectedTotal);
  const q3 = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { paymentMethod: "bank_transfer" } });
  assert.equal(q3.body.data.codChargeMinor, 0, "no surcharge for non-COD");

  const placed = await api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: address, paymentMethod: "cod", idempotencyKey: `cod-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.data.codChargeMinor, 5000);
  assert.equal(placed.body.data.grandTotalMinor, expectedTotal);
  const row = await prisma.order.findUnique({ where: { id: placed.body.data.id } });
  assert.equal(row.codChargeMinor, 5000, "persisted on the order");
  assert.equal(row.grandTotalMinor, expectedTotal);
  const payment = await prisma.payment.findFirst({ where: { orderId: row.id } });
  assert.equal(payment.amountMinor, expectedTotal, "pending payment carries the full amount incl. COD charge");

  await resetMethods(admin);
});

test("UPI QR upload/replace/remove is validated, public, and audited", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  const badType = await api("/admin/settings/payments/upi/qr", { method: "POST", token: admin, body: { name: "x.txt", mime: "text/plain", dataBase64: "aGVsbG8=" } });
  assert.equal(badType.status, 400);
  const corrupt = await api("/admin/settings/payments/upi/qr", { method: "POST", token: admin, body: { name: "x.png", mime: "image/png", dataBase64: Buffer.from("not an image at all!!").toString("base64") } });
  assert.equal(corrupt.status, 400);

  const up = await api("/admin/settings/payments/upi/qr", { method: "POST", token: admin, body: { name: "qr.png", mime: "image/png", dataBase64: PNG_B64 } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const url1 = up.body.data.config.qrUrl;
  assert.match(url1, /\/uploads\//);
  const img = await fetch(url1);
  assert.equal(img.status, 200, "QR image is publicly served");

  const rep = await api("/admin/settings/payments/upi/qr", { method: "POST", token: admin, body: { name: "qr2.png", mime: "image/png", dataBase64: PNG_B64 } });
  assert.notEqual(rep.body.data.config.qrUrl, url1, "replace yields a new file");
  assert.equal((await fetch(url1)).status, 404, "old file removed");

  // Partial config update must not wipe the QR url.
  const upd = await api("/admin/settings/payments/upi", { method: "PUT", token: admin, body: { config: { upiId: "zolo@okaxis" } } });
  assert.equal(upd.body.data.config.upiId, "zolo@okaxis");
  assert.equal(upd.body.data.config.qrUrl, rep.body.data.config.qrUrl);

  // Customer sees the public config.
  const buyer = await registerBuyer();
  const pub = await api("/checkout/payment-methods", { token: buyer.token });
  const upi = pub.body.data.methods.find((m) => m.key === "upi");
  assert.equal(upi.config.upiId, "zolo@okaxis");
  assert.equal(upi.config.qrUrl, rep.body.data.config.qrUrl);

  const rm = await api("/admin/settings/payments/upi/qr", { method: "DELETE", token: admin });
  assert.equal(rm.status, 200);
  assert.equal(rm.body.data.config.qrUrl, null);
  const audits = await prisma.auditLog.count({ where: { eventType: "payment_settings.qr_updated" } });
  assert.ok(audits >= 3, "upload/replace/remove audited");
});

// ---------------------------------------------------------------------------
// Notification settings
// ---------------------------------------------------------------------------

test("SMTP + WhatsApp settings persist encrypted and are never returned", async () => {
  const admin = await adminToken();
  const put = await api("/admin/settings/notifications/email", { method: "PUT", token: admin, body: {
    host: "smtp.example.test", port: 587, secure: false, user: "mailer@example.test", password: "s3cret-P@ss",
    fromEmail: "no-reply@example.test", fromName: "Zolo Test", replyTo: "", emailEnabled: true,
  } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const e = put.body.data.email;
  assert.equal(e.host, "smtp.example.test");
  assert.equal(e.passwordSet, true);
  assert.equal(e.configured, true);
  assert.equal(e.source, "database");
  assert.equal(JSON.stringify(put.body).includes("s3cret-P@ss"), false, "password must never be echoed");
  assert.equal("password" in e, false);
  assert.equal("smtpPassEnc" in e, false);

  const row = await prisma.notificationSetting.findUnique({ where: { id: "default" } });
  assert.notEqual(row.smtpPassEnc, "s3cret-P@ss", "stored encrypted, not plaintext");
  assert.equal(decryptField(row.smtpPassEnc), "s3cret-P@ss");

  // Saving again without a password keeps the stored one.
  const keep = await api("/admin/settings/notifications/email", { method: "PUT", token: admin, body: { host: "smtp.example.test", port: 465, secure: true, user: "mailer@example.test", fromEmail: "no-reply@example.test" } });
  assert.equal(keep.body.data.email.passwordSet, true);
  assert.equal(keep.body.data.email.port, 465);
  const audit = await prisma.auditLog.findFirst({ where: { eventType: "settings.smtp.updated" }, orderBy: { createdAt: "desc" } });
  assert.ok(audit);
  assert.equal(JSON.stringify(audit.metadata).includes("s3cret"), false, "audit never contains the password");

  const wa = await api("/admin/settings/notifications/whatsapp", { method: "PUT", token: admin, body: { provider: "meta", phoneNumberId: "1234567890", accessToken: "EAAB-super-secret-token", businessNumber: "+91 98765 43210", whatsappEnabled: true } });
  assert.equal(wa.status, 200, JSON.stringify(wa.body));
  assert.equal(wa.body.data.whatsapp.accessTokenSet, true);
  assert.equal(wa.body.data.whatsapp.businessNumber, "919876543210");
  assert.equal(JSON.stringify(wa.body).includes("EAAB-super"), false, "token never echoed");
  const row2 = await prisma.notificationSetting.findUnique({ where: { id: "default" } });
  assert.equal(decryptField(row2.whatsappAccessTokenEnc), "EAAB-super-secret-token");

  const get = await api("/admin/settings/notifications", { token: admin });
  assert.equal(get.status, 200);
  assert.equal(JSON.stringify(get.body).includes("s3cret"), false);
  assert.ok(Array.isArray(get.body.data.events) && get.body.data.events.length > 5);
  assert.ok(get.body.data.effectiveMatrix.ORDER_CREATED);

  // Customers cannot touch it.
  const buyer = await registerBuyer();
  assert.equal((await api("/admin/settings/notifications", { token: buyer.token })).status, 403);

  // Test email really attempts SMTP and reports the failure honestly (host does not exist).
  const t = await api("/admin/settings/notifications/email/test", { method: "POST", token: admin, body: { to: "someone@example.test" } });
  assert.equal(t.status, 200);
  assert.equal(t.body.data.status, "FAILED", JSON.stringify(t.body));
  assert.ok(t.body.data.error);
  const d = await prisma.notificationDelivery.findUnique({ where: { id: t.body.data.deliveryId } });
  assert.equal(d.channel, "email");
  assert.equal(d.status, "FAILED");
  assert.ok(d.failedAt);
  assert.equal(String(d.error).includes("s3cret"), false);

  // Clear the fake SMTP/WhatsApp config + channels so the shared dev database
  // is not left pointing at a host that does not exist.
  const cleared = await api("/admin/settings/notifications/email", { method: "PUT", token: admin, body: { host: "", port: 587, secure: false, user: "", clearPassword: true, fromEmail: "", emailEnabled: false } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.data.email.passwordSet, false);
  assert.equal(cleared.body.data.email.source === "database", false);
  const waCleared = await api("/admin/settings/notifications/whatsapp", { method: "PUT", token: admin, body: { provider: "", phoneNumberId: "", clearAccessToken: true, businessNumber: "", whatsappEnabled: false } });
  assert.equal(waCleared.body.data.whatsapp.accessTokenSet, false);
});

test("dispatch honours the admin channel switch + event matrix + customer preferences", async () => {
  const admin = await adminToken();
  const { dispatch } = await import("../src/services/notification-service.mjs");
  const { _invalidateAllSettingsCaches } = await import("../src/services/settings.mjs");

  // Channels off → deliveries recorded as SKIPPED (never claimed sent).
  await api("/admin/settings/notifications", { method: "PUT", token: admin, body: { emailEnabled: false, whatsappEnabled: false, inAppEnabled: true, eventMatrix: {} } });
  _invalidateAllSettingsCaches();
  const buyer = await registerBuyer();
  const r1 = await dispatch({ event: "ORDER_CONFIRMED", userId: buyer.userId, title: "T1", body: "B1", entityType: "Test", entityId: "1" });
  assert.equal(r1.inApp.status, "SENT");
  assert.equal(r1.email.status, "SKIPPED");
  assert.match(r1.email.error, /disabled by admin/);
  const inApp = await prisma.notification.findFirst({ where: { userId: buyer.userId, title: "T1" } });
  assert.ok(inApp, "in-app notification row written");

  // Matrix turns email off for that event → no email delivery attempted at all.
  await api("/admin/settings/notifications", { method: "PUT", token: admin, body: { emailEnabled: true, eventMatrix: { ORDER_CONFIRMED: { email: false, whatsapp: false, inApp: false } } } });
  _invalidateAllSettingsCaches();
  const r2 = await dispatch({ event: "ORDER_CONFIRMED", userId: buyer.userId, title: "T2", body: "B2" });
  assert.equal(r2.email, null);
  assert.equal(r2.inApp, null);

  // Customer opted out of WhatsApp → skipped with the reason even though admin enabled it.
  await api("/admin/settings/notifications", { method: "PUT", token: admin, body: { whatsappEnabled: true, eventMatrix: {} } });
  await api("/auth/me", { method: "PATCH", token: buyer.token, body: { preferences: { whatsapp: false, promotions: false } } });
  _invalidateAllSettingsCaches();
  const r3 = await dispatch({ event: "ORDER_DELIVERED", userId: buyer.userId, title: "T3", body: "B3" });
  assert.equal(r3.whatsapp.status, "SKIPPED");
  assert.match(r3.whatsapp.error, /opted out/);
  // Marketing respects promotions=false entirely.
  const r4 = await dispatch({ event: "PROMOTION", userId: buyer.userId, title: "Sale", body: "x" });
  assert.equal(r4.email, null);
  assert.equal(r4.inApp, null);

  const deliveries = await api("/admin/settings/notifications/deliveries?channel=whatsapp", { token: admin });
  assert.equal(deliveries.status, 200);
  assert.ok(deliveries.body.data.deliveries.some((d) => d.customer?.id === buyer.userId && d.status === "SKIPPED"));

  await api("/admin/settings/notifications", { method: "PUT", token: admin, body: { emailEnabled: false, whatsappEnabled: false, eventMatrix: {} } });
  _invalidateAllSettingsCaches();
});

// ---------------------------------------------------------------------------
// Payment requests
// ---------------------------------------------------------------------------

test("admin payment request → public token page → submit proof → approve updates the order", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  const buyer = await registerBuyer();
  const placed = await placeOrder(buyer, { productPriceMinor: 100000, qty: 3, paymentMethod: "bank_transfer" });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.data;
  assert.equal(order.paymentStatus, "PENDING");
  // Placing with an online method already created a link for the full amount.
  assert.ok(order.paymentRequest?.payUrl, "order carries its payment link");
  assert.equal(order.paymentRequest.amountMinor, order.grandTotalMinor);

  // Admin can also create a custom request (e.g. an advance) for this customer.
  const create = await api("/admin/payment-requests", { method: "POST", token: admin, body: {
    userId: buyer.userId, orderId: order.id, amountMinor: order.grandTotalMinor, title: `Payment for ${order.orderNumber}`, description: "Full payment", send: true,
    allowedMethods: ["upi", "bank_transfer"],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const pr = create.body.data;
  assert.equal(pr.status, "SENT");
  assert.match(pr.payUrl, /\/pay\/[a-f0-9]{64}$/);
  const token = pr.payUrl.split("/pay/")[1];

  // Customer sees an in-app notification with the link.
  const notif = await prisma.notification.findFirst({ where: { userId: buyer.userId, entityType: "PaymentRequest", entityId: pr.id } });
  assert.ok(notif, "customer notified in-app");
  const mine = await api("/me/payment-requests", { token: buyer.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.requests.some((r) => r.id === pr.id));

  // Public page: no auth; wrong token 404; amount comes from the server.
  const wrong = await api(`/public/pay/${"0".repeat(64)}`);
  assert.equal(wrong.status, 404);
  const page = await api(`/public/pay/${token}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.data.amountMinor, order.grandTotalMinor);
  assert.equal(page.body.data.canSubmit, true);
  assert.ok(page.body.data.methods.some((m) => m.key === "upi"));
  assert.equal("tokenHash" in page.body.data, false);
  assert.equal("payUrl" in page.body.data, false);

  // Submission requires a reference or a proof; client cannot set the amount.
  const noProof = await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "upi" } });
  assert.equal(noProof.status, 400);
  const badMethod = await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "cheque", reference: "CHQ1" } });
  assert.equal(badMethod.status, 400, "cheque not in allowedMethods");
  const sub = await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "upi", reference: "UTR123456", amountMinor: 1, proof: { name: "shot.png", mime: "image/png", dataBase64: PNG_B64 } } });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  assert.equal(sub.body.data.status, "SUBMITTED");
  assert.equal(sub.body.data.amountMinor, order.grandTotalMinor, "client-sent amount ignored");
  assert.equal(sub.body.data.proof.hasFile, true);
  const again = await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "upi", reference: "UTR2" } });
  assert.equal(again.status, 409, "double submission blocked");

  // Not paid until the admin verifies.
  let o = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "PENDING");
  const adminAlert = await prisma.notification.findFirst({ where: { type: "payment_request.submitted", entityId: pr.id } });
  assert.ok(adminAlert, "admins alerted to review");

  // Proof download is admin-only.
  const proofAnon = await apiRaw(`/admin/payment-requests/${pr.id}/proof`);
  assert.equal(proofAnon.status, 401);
  const proofBuyer = await apiRaw(`/admin/payment-requests/${pr.id}/proof`, { token: buyer.token });
  assert.equal(proofBuyer.status, 403);
  const proof = await apiRaw(`/admin/payment-requests/${pr.id}/proof`, { token: admin });
  assert.equal(proof.status, 200);
  assert.equal(proof.contentType, "image/png");

  const list = await api("/admin/payment-requests?status=SUBMITTED", { token: admin });
  assert.ok(list.body.data.requests.some((r) => r.id === pr.id));

  const approve = await api(`/admin/payment-requests/${pr.id}/approve`, { method: "POST", token: admin, body: { note: "Verified in bank statement" } });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.data.status, "PAID");
  assert.equal(approve.body.data.payment.status, "PAID");
  assert.equal(approve.body.data.payment.reference, "UTR123456");

  o = await prisma.order.findUnique({ where: { id: order.id }, include: { payments: true } });
  assert.equal(o.paymentStatus, "PAID", "order payment status re-derived");
  assert.equal(o.paidMinor, order.grandTotalMinor);
  assert.equal(o.payments.filter((p) => p.status === "PAID").length, 1, "the pending placement payment was reused, not duplicated");
  const audit = await prisma.auditLog.findFirst({ where: { eventType: "payment_request.paid", entityId: pr.id } });
  assert.ok(audit, "approval audited");
  const paidNotif = await prisma.notification.findFirst({ where: { userId: buyer.userId, type: "payment_received" } });
  assert.ok(paidNotif, "customer told payment was received");

  // Customer's payment history + finance show it.
  const pay = await api("/me/payments", { token: buyer.token });
  assert.ok(pay.body.data.payments.some((p) => p.orderNumber === order.orderNumber && p.status === "PAID"));

  // Idempotent approve; cannot cancel a paid request.
  assert.equal((await api(`/admin/payment-requests/${pr.id}/approve`, { method: "POST", token: admin })).status, 200);
  assert.equal((await api(`/admin/payment-requests/${pr.id}/cancel`, { method: "POST", token: admin })).status, 409);
  const closed = await api(`/public/pay/${token}`);
  assert.equal(closed.body.data.canSubmit, false);
});

test("reject sends the request back to the customer; expiry and cancel close it; guards hold", async () => {
  const admin = await adminToken();
  await resetMethods(admin);
  const buyer = await registerBuyer();
  const other = await registerBuyer();

  const create = await api("/admin/payment-requests", { method: "POST", token: admin, body: { userId: buyer.userId, amountMinor: 250000, title: "Advance for custom boxes" } });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const pr = create.body.data;
  const token = pr.payUrl.split("/pay/")[1];

  // Another customer cannot see it in their list; admin cannot create for a non-customer/foreign order.
  const otherMine = await api("/me/payment-requests", { token: other.token });
  assert.ok(!otherMine.body.data.requests.some((r) => r.id === pr.id));
  const foreign = await api("/admin/payment-requests", { method: "POST", token: admin, body: { userId: other.userId, orderId: "nope", amountMinor: 1000, title: "x" } });
  assert.equal(foreign.status, 400);
  assert.equal((await api("/admin/payment-requests", { method: "POST", token: buyer.token, body: { userId: buyer.userId, amountMinor: 1000, title: "x" } })).status, 403);

  await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "bank_transfer", reference: "WRONG-UTR" } });
  const rej = await api(`/admin/payment-requests/${pr.id}/reject`, { method: "POST", token: admin, body: { note: "UTR not found" } });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal(rej.body.data.status, "SENT", "customer may resubmit");
  const page = await api(`/public/pay/${token}`);
  assert.equal(page.body.data.canSubmit, true);
  assert.equal(page.body.data.reviewNote, "UTR not found");
  const failNotif = await prisma.notification.findFirst({ where: { userId: buyer.userId, type: "payment_failed" } });
  assert.ok(failNotif, "customer told to resubmit");

  // Resend keeps the same link.
  const resend = await api(`/admin/payment-requests/${pr.id}/resend`, { method: "POST", token: admin });
  assert.equal(resend.status, 200);
  assert.equal(resend.body.data.payUrl, pr.payUrl);

  // Cancel closes it.
  const cancel = await api(`/admin/payment-requests/${pr.id}/cancel`, { method: "POST", token: admin });
  assert.equal(cancel.body.data.status, "CANCELLED");
  const sub = await api(`/public/pay/${token}/submit`, { method: "POST", body: { method: "bank_transfer", reference: "X" } });
  assert.equal(sub.status, 409);

  // Expiry is enforced lazily.
  const exp = await api("/admin/payment-requests", { method: "POST", token: admin, body: { userId: buyer.userId, amountMinor: 1000, title: "Expiring", expiresAt: new Date(Date.now() + 2000).toISOString() } });
  assert.equal(exp.status, 201, JSON.stringify(exp.body));
  await prisma.paymentRequest.update({ where: { id: exp.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expPage = await api(`/public/pay/${exp.body.data.payUrl.split("/pay/")[1]}`);
  assert.equal(expPage.body.data.status, "EXPIRED");
  assert.equal(expPage.body.data.canSubmit, false);

  // A request cannot offer a method the admin has disabled.
  await api("/admin/settings/payments/upi", { method: "PUT", token: admin, body: { enabled: false } });
  const only = await api("/admin/payment-requests", { method: "POST", token: admin, body: { userId: buyer.userId, amountMinor: 1000, title: "No UPI", allowedMethods: ["upi"] } });
  assert.equal(only.status, 400);
  await api("/admin/settings/payments/upi", { method: "PUT", token: admin, body: { enabled: true } });
});
