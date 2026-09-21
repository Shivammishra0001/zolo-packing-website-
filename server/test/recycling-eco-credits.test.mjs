// Returns & Recycling → Recycling requests, rules, the Eco Credit ledger and
// redemption into a customer-specific coupon in the EXISTING coupon system.
//
//   material → verified quantity → active rule → credits/unit → Eco Credits
//   → wallet → redemption → customer-specific coupon → checkout
//
// Every number asserted here is produced by the server from admin-owned rows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, apiRaw, adminToken, registerBuyer, registerSeller, makeProduct, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const ruleIds = [];
let ADMIN;
const STARTED = new Date();

before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  // Global configuration goes back to "nothing configured".
  await prisma.ecoRewardSetting.update({
    where: { id: "default" },
    data: { enabled: false, minCreditsToRedeem: null, creditsRequired: null, couponValueMinor: null, couponValidityDays: null, couponMinOrderMinor: null, couponUsageLimit: 1, maxUnitsPerRedemption: 1, allowCombine: false, appliesTo: "all", productIds: [], categoryIds: [], creditExpiryEnabled: false, creditExpiryDays: null },
  }).catch(() => {});
  if (ruleIds.length) {
    await prisma.recyclingRequest.deleteMany({ where: { ruleId: { in: ruleIds } } });
    await prisma.recyclingRule.deleteMany({ where: { id: { in: ruleIds } } });
  }
  await stopServer();
});

const admin = (path, opt = {}) => api(path, { token: ADMIN, ...opt });
async function makeRule(body = {}) {
  const res = await admin("/admin/recycling/rules", { method: "POST", body: { material: `Cardboard ${rnd()}`, unit: "kg", creditsPerUnit: 10, minQuantity: 1, maxQuantity: 100, ...body } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ruleIds.push(res.body.data.id);
  return res.body.data;
}
async function submit(buyer, rule, estimatedQuantity = 10, extra = {}) {
  const pickupAddressId = buyer.addressId ?? (buyer.addressId = await makeAddress(buyer.token));
  return api("/recycling/requests", { method: "POST", token: buyer.token, body: { material: rule.material, unit: rule.unit, estimatedQuantity, description: "Flattened boxes", pickupAddressId, ...extra } });
}
const step = (id, action, body) => admin(`/admin/recycling/requests/${id}/${action}`, { method: "POST", body });
/** pickup → received → verify; returns the verify response. */
async function receiveAndVerify(id, rule, verifiedQuantity, extra = {}) {
  await step(id, "received");
  return step(id, "verify", { verifiedQuantity, ruleId: rule.id, condition: "clean", adminNotes: "Verified clean packaging", ...extra });
}
/** A buyer who already holds `credits` (through a real approved request). */
async function buyerWithCredits(credits) {
  const buyer = await registerBuyer();
  const rule = await makeRule({ creditsPerUnit: 1, minQuantity: null, maxQuantity: null });
  const req = (await submit(buyer, rule, credits)).body.data;
  await receiveAndVerify(req.id, rule, credits);
  const ok = await step(req.id, "approve");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return buyer;
}
const wallet = async (buyer) => (await api("/eco-credits", { token: buyer.token })).body.data;
const configureRewards = (body = {}) =>
  admin("/admin/eco-credits/settings", { method: "PUT", body: { enabled: true, creditsRequired: 100, couponValueMinor: 5000, couponValidityDays: 30, minCreditsToRedeem: 100, couponMinOrderMinor: 10000, couponUsageLimit: 1, maxUnitsPerRedemption: 1, appliesTo: "all", creditExpiryEnabled: false, ...body } });

test("TESTS 1–7: rule 10/kg → request 10 kg est. → verified 8.5 kg → 85 credits → approve → wallet +85 → ledger row", async () => {
  const rule = await makeRule();
  assert.equal(rule.creditsPerUnit, 10);
  const buyer = await registerBuyer();

  // The customer supplies an ESTIMATE only. Any credit/verified field is refused outright.
  for (const forged of [{ credits: 9999 }, { creditsAwarded: 9999 }, { verifiedQuantity: 500 }, { status: "APPROVED" }]) {
    assert.equal((await submit(buyer, rule, 10, forged)).status, 400, JSON.stringify(forged));
  }
  const created = await submit(buyer, rule, 10);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const req = created.body.data;
  assert.match(req.requestNumber, /^RCY-\d{4}-\d{6}$/);
  assert.equal(req.status, "PENDING");
  assert.equal(req.estimatedQuantity, 10);
  assert.equal(req.creditsAwarded, null);
  assert.equal(req.pickup.city !== undefined, true);

  // Photos go through private storage: owner + admin can read, nobody else.
  const up = await api(`/recycling/requests/${req.id}/files`, { method: "POST", token: buyer.token, body: { fileName: "boxes.png", mime: "image/png", dataBase64: PNG_B64 } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal((await apiRaw(`/recycling/requests/${req.id}/files/${up.body.data.id}/download`, { token: buyer.token })).status, 200);
  assert.equal((await apiRaw(`/admin/recycling/requests/${req.id}/files/${up.body.data.id}/download`, { token: ADMIN })).status, 200);
  const stranger = await registerBuyer();
  assert.equal((await apiRaw(`/recycling/requests/${req.id}/files/${up.body.data.id}/download`, { token: stranger.token })).status, 404);
  assert.equal((await api(`/recycling/requests/${req.id}/files`, { method: "POST", token: buyer.token, body: { fileName: "x.pdf", mime: "application/pdf", dataBase64: PNG_B64 } })).status, 400, "images only");

  // Workflow: Pending → Scheduled Pickup → Received → Under Verification → Approved.
  assert.equal((await step(req.id, "verify", { verifiedQuantity: 8.5, ruleId: rule.id })).status, 409, "cannot verify before the material is received");
  assert.equal((await step(req.id, "approve")).status, 409, "cannot approve before verification");
  assert.equal((await step(req.id, "pickup", { date: new Date(Date.now() + 86_400_000).toISOString() })).body.data.status, "PICKUP_SCHEDULED");
  assert.equal((await step(req.id, "received")).body.data.status, "RECEIVED");

  // The admin types a quantity + picks a rule. A typed credit amount is refused.
  assert.equal((await step(req.id, "verify", { verifiedQuantity: 8.5, ruleId: rule.id, credits: 5000 })).status, 400);
  const verified = await step(req.id, "verify", { verifiedQuantity: 8.5, ruleId: rule.id, condition: "clean", adminNotes: "Verified clean cardboard packaging" });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.data.status, "UNDER_VERIFICATION");
  const calc = verified.body.data.calculation;
  assert.equal(calc.credits, 85);
  assert.equal(calc.verifiedQuantity, 8.5);
  assert.equal(calc.creditsPerUnit, 10);
  assert.equal(calc.formula, "8.5 kg × 10 credits/kg = 85 Eco Credits");

  // Nothing is awarded before approval.
  assert.equal((await wallet(buyer)).balance, 0);
  assert.equal((await api(`/recycling/requests/${req.id}`, { token: buyer.token })).body.data.creditsAwarded, null);

  // Approve: the body's number is only a staleness check; the server recalculates.
  assert.equal((await step(req.id, "approve", { expectedCredits: 9999 })).status, 409, "a forged amount never becomes the award");
  assert.equal((await wallet(buyer)).balance, 0);
  const approved = await step(req.id, "approve", { expectedCredits: 85 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.status, "APPROVED");
  assert.equal(approved.body.data.creditsAwarded, 85);

  const w = await wallet(buyer);
  assert.equal(w.balance, 85);
  assert.equal(w.transactions.length, 1);
  assert.deepEqual(
    { type: w.transactions[0].type, amount: w.transactions[0].amount, balanceAfter: w.transactions[0].balanceAfter },
    { type: "RECYCLING_REWARD", amount: 85, balanceAfter: 85 },
  );
  assert.match(w.transactions[0].description, /^Recycled cardboard .* — 8\.5 kg$/i);

  // Idempotent: a second approval cannot credit again.
  assert.equal((await step(req.id, "approve")).status, 409);
  assert.equal((await wallet(buyer)).balance, 85);
  assert.equal(await prisma.ecoCreditTransaction.count({ where: { source: "RecyclingRequest", referenceId: req.id } }), 1);

  // The customer sees the same transparent working.
  const mine = (await api(`/recycling/requests/${req.id}`, { token: buyer.token })).body.data;
  assert.equal(mine.calculation.formula, "8.5 kg × 10 credits/kg = 85 Eco Credits");
  assert.equal(mine.verifiedQuantity, 8.5);
});

test("the calculation: rounds DOWN, enforces min/max/unit/material, refuses inactive rules and 0-credit awards", async () => {
  const rule = await makeRule({ creditsPerUnit: 10, minQuantity: 1, maxQuantity: 100 });
  const buyer = await registerBuyer();
  const make = async () => { const r = (await submit(buyer, rule, 5)).body.data; await step(r.id, "received"); return r; };

  const a = await make();
  const v = await step(a.id, "verify", { verifiedQuantity: 7.85, ruleId: rule.id });
  assert.equal(v.body.data.calculation.credits, 78, "7.85 × 10 = 78.5 → 78");
  assert.equal((await step(a.id, "verify", { verifiedQuantity: 7.8, ruleId: rule.id })).body.data.calculation.credits, 78, "re-verification is allowed until approval");

  const expectCode = async (id, body, code) => {
    const res = await step(id, "verify", body);
    assert.ok([400, 409].includes(res.status), JSON.stringify(res.body));
    assert.equal(res.body.code, code, JSON.stringify(res.body));
  };
  await expectCode(a.id, { verifiedQuantity: 0.5, ruleId: rule.id }, "BELOW_MINIMUM");
  await expectCode(a.id, { verifiedQuantity: 100.001, ruleId: rule.id }, "ABOVE_MAXIMUM");
  assert.equal((await step(a.id, "verify", { verifiedQuantity: 1.2345, ruleId: rule.id })).status, 400, "at most 3 decimals");
  assert.equal((await step(a.id, "verify", { verifiedQuantity: -3, ruleId: rule.id })).status, 400);

  const otherMaterial = await makeRule({ material: `Glass ${rnd()}` });
  await expectCode(a.id, { verifiedQuantity: 5, ruleId: otherMaterial.id }, "RULE_MATERIAL_MISMATCH");
  const otherUnit = await makeRule({ material: rule.material, unit: "piece" });
  await expectCode(a.id, { verifiedQuantity: 5, ruleId: otherUnit.id }, "RULE_UNIT_MISMATCH");
  await expectCode(a.id, { verifiedQuantity: 5, ruleId: "no-such-rule" }, "RULE_NOT_FOUND");

  // Fractional rates: 0.5 credits per piece, 3 pieces → 1 (1.5 rounded down); 1 piece → 0 → cannot be approved.
  const half = await makeRule({ material: `Bottle ${rnd()}`, unit: "piece", creditsPerUnit: 0.5, minQuantity: null, maxQuantity: null });
  const b = (await submit(buyer, half, 3)).body.data;
  await step(b.id, "received");
  assert.equal((await step(b.id, "verify", { verifiedQuantity: 3, ruleId: half.id })).body.data.calculation.credits, 1);
  await step(b.id, "verify", { verifiedQuantity: 1, ruleId: half.id });
  const zero = await step(b.id, "approve");
  assert.equal(zero.status, 400);
  assert.equal(zero.body.code, "ZERO_CREDITS");

  // Rejection needs a reason and never credits.
  assert.equal((await step(b.id, "reject", {})).status, 400);
  const rejected = await step(b.id, "reject", { reason: "Contaminated with food waste" });
  assert.equal(rejected.body.data.status, "REJECTED");
  assert.equal((await step(b.id, "approve")).status, 409);
  assert.equal((await wallet(buyer)).balance, 0);
});

test("TESTS 8–14 + 21: redeem 100 credits → customer-specific coupon → checkout; insufficient balance, other customers and reuse all fail", async () => {
  // Nothing is redeemable until the admin configures it (no built-in conversion).
  await admin("/admin/eco-credits/settings", { method: "PUT", body: { enabled: false } });
  const buyer = await buyerWithCredits(85);
  const off = await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: {} });
  assert.equal(off.status, 409);
  assert.equal(off.body.code, "REWARDS_DISABLED");

  // Enabling without a conversion is refused field by field.
  const bad = await admin("/admin/eco-credits/settings", { method: "PUT", body: { enabled: true, creditsRequired: null, couponValueMinor: null, couponValidityDays: null } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.issues.some((i) => i.path === "creditsRequired"));

  const set = await configureRewards();
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.ready, true);

  // The storefront reads the conversion from the API — nothing is hard-coded.
  const program = (await api("/recycling/program")).body.data;
  assert.deepEqual(
    { c: program.reward.creditsRequired, v: program.reward.couponValueMinor, d: program.reward.couponValidityDays },
    { c: 100, v: 5000, d: 30 },
  );

  // 13: 85 < 100 → refused, and no coupon was created.
  const couponsBefore = await prisma.coupon.count({ where: { assignedUserId: buyer.userId } });
  const poor = await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: {} });
  assert.equal(poor.status, 400);
  assert.equal(poor.body.code, "INSUFFICIENT_CREDITS");
  assert.equal(await prisma.coupon.count({ where: { assignedUserId: buyer.userId } }), couponsBefore);
  assert.equal((await wallet(buyer)).balance, 85);

  // 22: manual credit (+50) → 135, always with a ledger row.
  const adj = await admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: buyer.userId, direction: "credit", amount: 50, reason: "Additional verified recycling incentive", adminNote: "Ticket #42" } });
  assert.equal(adj.status, 201, JSON.stringify(adj.body));
  assert.equal(adj.body.data.balance, 135);

  // The customer cannot choose the price: extra body fields are ignored, units are capped.
  const greedy = await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: { units: 5 } });
  assert.equal(greedy.status, 400);
  assert.equal(greedy.body.code, "TOO_MANY_UNITS");

  // 8–11: redeem.
  const red = await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: { units: 1, couponValueMinor: 9_999_900, creditsRequired: 1 } });
  assert.equal(red.status, 201, JSON.stringify(red.body));
  const coupon = red.body.data.coupon;
  assert.match(coupon.code, /^ECO-[A-Z2-9]{6}$/);
  assert.equal(coupon.valueMinor, 5000, "value comes from the settings row, not the request");
  assert.equal(red.body.data.creditsSpent, 100);
  assert.equal(red.body.data.balance, 35);
  const days = (new Date(coupon.expiresAt) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days < 30.1, `expires in ${days} days`);

  const row = await prisma.coupon.findUnique({ where: { code: coupon.code } });
  assert.deepEqual(
    { source: row.source, assignedUserId: row.assignedUserId, type: row.discountType, value: row.discountValue, limit: row.usageLimit, per: row.usageLimitPerCustomer, min: row.minOrderMinor },
    { source: "eco_reward", assignedUserId: buyer.userId, type: "flat", value: 5000, limit: 1, per: 1, min: 10000 },
  );

  const w = await wallet(buyer);
  assert.equal(w.balance, 35);
  assert.deepEqual(w.transactions.map((t) => [t.type, t.amount, t.balanceAfter]), [["REDEMPTION", -100, 35], ["MANUAL_CREDIT", 50, 135], ["RECYCLING_REWARD", 85, 85]]);
  assert.match(w.transactions[0].description, /Redeemed ₹50 coupon \(ECO-/);
  assert.equal(w.coupons.length, 1);
  assert.equal(w.coupons[0].status, "active");
  assert.equal((await api("/eco-credits/coupons", { token: buyer.token })).body.data.coupons[0].code, coupon.code);

  // Reward coupons are not public marketing coupons.
  assert.ok(!(await admin("/admin/coupons")).body.data.coupons.some((c) => c.code === coupon.code));

  // 13 again: 35 credits left.
  assert.equal((await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: {} })).body.code, "INSUFFICIENT_CREDITS");

  // 12: the EXISTING checkout engine honours it for its owner…
  const product = await makeProduct({ priceMinor: 50_000, stock: 50 });
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 1 } });
  const quote = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { couponCode: coupon.code.toLowerCase() } });
  assert.equal(quote.body.data.couponCode, coupon.code);
  assert.equal(quote.body.data.discountMinor, 5000);

  // 14: …and for nobody else — not even as "exists but not yours".
  const thief = await registerBuyer();
  await api("/cart/items", { method: "POST", token: thief.token, body: { productId: product.id, quantity: 1 } });
  const stolen = await api("/checkout/quote", { method: "POST", token: thief.token, body: { couponCode: coupon.code } });
  assert.equal(stolen.body.data.discountMinor, 0);
  assert.match(stolen.body.data.couponError, /not found/i);
  assert.equal((await api("/coupons/validate", { method: "POST", token: thief.token, body: { code: coupon.code } })).body.data.valid, false);
  const theftOrder = await api("/checkout/place", { method: "POST", token: thief.token, body: { shippingAddressId: await makeAddress(thief.token), couponCode: coupon.code } });
  assert.equal(theftOrder.status, 400);

  // Minimum order from the settings is enforced by the same engine.
  const cheap = await makeProduct({ priceMinor: 5_000, stock: 50 });
  const smallCart = await buyerWithCredits(100);
  const smallCoupon = (await api("/eco-credits/redeem", { method: "POST", token: smallCart.token, body: {} })).body.data.coupon;
  await api("/cart/items", { method: "POST", token: smallCart.token, body: { productId: cheap.id, quantity: 1 } });
  assert.match((await api("/checkout/quote", { method: "POST", token: smallCart.token, body: { couponCode: smallCoupon.code } })).body.data.couponError, /minimum/i);

  // Use it, then 21: it cannot be used twice.
  const placed = await api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: buyer.addressId, couponCode: coupon.code } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.data.discountMinor, 5000);
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 1 } });
  const again = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { couponCode: coupon.code } });
  assert.equal(again.body.data.discountMinor, 0);
  assert.match(again.body.data.couponError, /limit|already used/i);
  assert.equal((await wallet(buyer)).coupons[0].status, "used");

  // A used coupon cannot be reversed.
  const rev = await admin(`/admin/eco-credits/coupons/${coupon.id}/revoke`, { method: "POST", body: { reason: "Customer asked" } });
  assert.equal(rev.status, 409);
  assert.equal(rev.body.code, "COUPON_USED");
});

test("TEST 20: an expired Eco Reward coupon is refused; an unused one can be revoked and the credits come back (REVERSAL)", async () => {
  await configureRewards({ couponMinOrderMinor: null });
  const buyer = await buyerWithCredits(200);
  const first = (await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: {} })).body.data.coupon;
  const product = await makeProduct({ priceMinor: 50_000, stock: 10 });
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 1 } });
  assert.equal((await api("/checkout/quote", { method: "POST", token: buyer.token, body: { couponCode: first.code } })).body.data.discountMinor, 5000);

  await prisma.coupon.update({ where: { id: first.id }, data: { validUntil: new Date(Date.now() - 1000) } });
  const late = await api("/checkout/quote", { method: "POST", token: buyer.token, body: { couponCode: first.code } });
  assert.equal(late.body.data.discountMinor, 0);
  assert.match(late.body.data.couponError, /expired/i);
  assert.equal((await wallet(buyer)).coupons.find((c) => c.id === first.id).status, "expired");

  // Revoke the second, unused coupon.
  const second = (await api("/eco-credits/redeem", { method: "POST", token: buyer.token, body: {} })).body.data.coupon;
  assert.equal((await wallet(buyer)).balance, 0);
  assert.equal((await admin(`/admin/eco-credits/coupons/${second.id}/revoke`, { method: "POST", body: {} })).status, 400, "reason required");
  const rev = await admin(`/admin/eco-credits/coupons/${second.id}/revoke`, { method: "POST", body: { reason: "Issued by mistake" } });
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(rev.body.data.creditsReturned, 100);
  const w = await wallet(buyer);
  assert.equal(w.balance, 100);
  assert.deepEqual([w.transactions[0].type, w.transactions[0].amount], ["REVERSAL", 100]);
  assert.equal(w.coupons.find((c) => c.id === second.id).status, "revoked");
  assert.match((await api("/checkout/quote", { method: "POST", token: buyer.token, body: { couponCode: second.code } })).body.data.couponError, /not active/i);
  assert.equal((await admin(`/admin/eco-credits/coupons/${second.id}/revoke`, { method: "POST", body: { reason: "again" } })).status, 409, "cannot return the credits twice");
});

test("TESTS 15–19: rule 10 → 12 keeps history at 10; new requests use 12; a deactivated rule cannot approve or accept requests", async () => {
  const rule = await makeRule({ creditsPerUnit: 10 });
  const buyer = await registerBuyer();
  const old = (await submit(buyer, rule, 10)).body.data;
  await receiveAndVerify(old.id, rule, 8.5);
  await step(old.id, "approve", { expectedCredits: 85 });

  // A request verified at 10/kg but not yet approved…
  const inFlight = (await submit(buyer, rule, 4)).body.data;
  assert.equal((await receiveAndVerify(inFlight.id, rule, 4)).body.data.calculation.credits, 40);

  // 15: change the rule.
  const changed = await admin(`/admin/recycling/rules/${rule.id}`, { method: "PATCH", body: { creditsPerUnit: 12 } });
  assert.equal(changed.body.data.creditsPerUnit, 12);

  // 16: history is a snapshot — never recalculated with today's rule.
  const hist = (await admin(`/admin/recycling/requests/${old.id}`)).body.data;
  assert.equal(hist.calculation.snapshot, true);
  assert.equal(hist.calculation.creditsPerUnit, 10);
  assert.equal(hist.calculation.formula, "8.5 kg × 10 credits/kg = 85 Eco Credits");
  assert.equal(hist.creditsAwarded, 85);
  const snap = await prisma.recyclingRequest.findUnique({ where: { id: old.id } });
  assert.deepEqual(
    [snap.ruleId, snap.ruleMaterial, snap.ruleUnit, snap.ruleCreditsPerUnitX100, snap.verifiedQuantityMilli, snap.creditsAwarded],
    [rule.id, rule.material, "kg", 1000, 8500, 85],
  );
  assert.equal((await wallet(buyer)).balance, 85);

  // …the in-flight one shows the NEW figure, and approving with the stale number is refused.
  assert.equal((await admin(`/admin/recycling/requests/${inFlight.id}`)).body.data.calculation.credits, 48);
  const stale = await step(inFlight.id, "approve", { expectedCredits: 40 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "CALCULATION_CHANGED");

  // 17: a new request uses 12/kg.
  const fresh = (await submit(buyer, rule, 5)).body.data;
  const v = await receiveAndVerify(fresh.id, rule, 5);
  assert.equal(v.body.data.calculation.formula, "5 kg × 12 credits/kg = 60 Eco Credits");

  // 18–19: deactivate.
  const offRule = await admin(`/admin/recycling/rules/${rule.id}/deactivate`, { method: "POST" });
  assert.equal(offRule.body.data.isActive, false);
  const blocked = await step(fresh.id, "approve");
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "RULE_INACTIVE");
  assert.equal((await step(fresh.id, "verify", { verifiedQuantity: 5, ruleId: rule.id })).body.code, "RULE_INACTIVE");
  assert.equal((await wallet(buyer)).balance, 85, "nothing was awarded through the inactive rule");

  const refused = await submit(buyer, rule, 3);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "MATERIAL_NOT_ELIGIBLE");
  assert.ok(!(await api("/recycling/program")).body.data.materials.some((m) => m.ruleId === rule.id), "inactive materials are not advertised");

  // Reactivate → approvable again at 12/kg. Archive keeps history intact.
  await admin(`/admin/recycling/rules/${rule.id}/activate`, { method: "POST" });
  assert.equal((await step(fresh.id, "approve", { expectedCredits: 60 })).body.data.creditsAwarded, 60);
  assert.equal((await admin(`/admin/recycling/rules/${rule.id}`, { method: "DELETE" })).status, 200);
  assert.ok(await prisma.recyclingRule.findUnique({ where: { id: rule.id } }), "archived, not deleted");
  assert.ok(!(await admin("/admin/recycling/rules")).body.data.rules.some((r) => r.id === rule.id));
  assert.equal((await admin(`/admin/recycling/requests/${old.id}`)).body.data.calculation.credits, 85);

  // Rule validation.
  const dup = await makeRule({ material: `Paper ${rnd()}` });
  const clash = await admin("/admin/recycling/rules", { method: "POST", body: { material: dup.material.toLowerCase(), unit: "kg", creditsPerUnit: 8 } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, "RULE_EXISTS");
  for (const body of [{ creditsPerUnit: 0 }, { creditsPerUnit: -5 }, { creditsPerUnit: 1.234 }, { unit: "tonne" }, { material: "" }, { minQuantity: 10, maxQuantity: 5 }]) {
    const res = await admin("/admin/recycling/rules", { method: "POST", body: { material: `Metal ${rnd()}`, unit: "kg", creditsPerUnit: 20, ...body } });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("TEST 22: manual adjustments always write a ledger row, need a reason, and can never push a balance below zero", async () => {
  const buyer = await buyerWithCredits(40);
  const post = (body) => admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: buyer.userId, ...body } });
  assert.equal((await post({ direction: "credit", amount: 20 })).status, 400, "reason is mandatory");
  assert.equal((await post({ direction: "credit", amount: 20, reason: "  " })).status, 400);
  assert.equal((await post({ direction: "credit", amount: 0, reason: "zero" })).status, 400);
  assert.equal((await post({ direction: "credit", amount: 2.5, reason: "fraction" })).status, 400);
  assert.equal((await post({ direction: "sideways", amount: 5, reason: "bad type" })).status, 400);
  assert.equal((await admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: "nobody", direction: "credit", amount: 5, reason: "ghost" } })).status, 404);

  assert.equal((await post({ direction: "credit", amount: 20, reason: "Admin adjustment" })).body.data.balance, 60);
  assert.equal((await post({ direction: "debit", amount: 15, reason: "Duplicate award corrected" })).body.data.balance, 45);
  const over = await post({ direction: "debit", amount: 46, reason: "Too much" });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, "INSUFFICIENT_CREDITS");

  const w = await wallet(buyer);
  assert.equal(w.balance, 45);
  assert.deepEqual(w.transactions.map((t) => [t.type, t.amount, t.balanceAfter]), [["MANUAL_DEBIT", -15, 45], ["MANUAL_CREDIT", 20, 60], ["RECYCLING_REWARD", 40, 40]]);
  const rows = await prisma.ecoCreditTransaction.findMany({ where: { userId: buyer.userId, source: "manual" } });
  assert.ok(rows.every((r) => r.reason && r.createdById), "who and why are recorded");

  // Admin's view of one customer + the search used by the adjustment form.
  const ledger = await admin(`/admin/eco-credits/customers/${buyer.userId}`);
  assert.equal(ledger.body.data.balance, 45);
  assert.equal(ledger.body.data.transactions.length, 3);
  assert.ok((await admin(`/admin/eco-credits/customers?q=${encodeURIComponent(buyer.email)}`)).body.data.customers.some((c) => c.id === buyer.userId && c.balance === 45));
});

test("the ledger reconciles under concurrency: parallel writers never lose or duplicate a credit", async () => {
  const buyer = await buyerWithCredits(10);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: buyer.userId, direction: i % 3 === 0 ? "debit" : "credit", amount: 5, reason: `parallel ${i}` } })));
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
  const rows = await prisma.ecoCreditTransaction.findMany({ where: { userId: buyer.userId }, orderBy: { seq: "asc" } });
  let running = 0;
  for (const r of rows) { running += r.amount; assert.equal(r.balanceAfter, running, `row ${r.seq}`); }
  assert.equal(running, 10 + 8 * 5 - 4 * 5);
  assert.equal((await wallet(buyer)).balance, running);

  // Two simultaneous redemptions of the last 100 credits: exactly one wins.
  await configureRewards({ couponMinOrderMinor: null });
  const racer = await buyerWithCredits(100);
  const race = await Promise.all([0, 1].map(() => api("/eco-credits/redeem", { method: "POST", token: racer.token, body: {} })));
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 400]);
  assert.equal((await wallet(racer)).balance, 0);
  assert.equal(await prisma.coupon.count({ where: { assignedUserId: racer.userId } }), 1);

  const overview = (await admin("/admin/eco-credits/overview")).body.data;
  assert.equal(overview.ledger.reconciled, true);
});

test("credit expiry is OFF unless the admin enables it; when on it is a ledger row (FIFO), never a silent delete", async () => {
  await configureRewards({ creditExpiryEnabled: false, creditExpiryDays: null });
  const buyer = await buyerWithCredits(300);
  const old = await prisma.ecoCreditTransaction.findFirst({ where: { userId: buyer.userId } });
  await prisma.ecoCreditTransaction.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
  assert.equal((await wallet(buyer)).balance, 300, "400-day-old credits stay while expiry is off");
  const disabled = await admin("/admin/eco-credits/expire", { method: "POST" });
  assert.equal(disabled.status, 409);

  // A debit consumes the OLDEST credits first…
  await admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: buyer.userId, direction: "debit", amount: 120, reason: "Spent" } });
  await admin("/admin/eco-credits/adjustments", { method: "POST", body: { userId: buyer.userId, direction: "credit", amount: 50, reason: "Recent bonus" } });

  assert.equal((await admin("/admin/eco-credits/settings", { method: "PUT", body: { creditExpiryEnabled: true } })).status, 400, "expiry needs a number of days");
  assert.equal((await admin("/admin/eco-credits/settings", { method: "PUT", body: { creditExpiryEnabled: true, creditExpiryDays: 365 } })).status, 200);

  // …so 300 old − 120 spent = 180 expire; the recent 50 survive.
  const w = await wallet(buyer);
  assert.equal(w.balance, 50);
  assert.deepEqual([w.transactions[0].type, w.transactions[0].amount, w.transactions[0].balanceAfter], ["EXPIRATION", -180, 50]);
  assert.equal((await wallet(buyer)).transactions.filter((t) => t.type === "EXPIRATION").length, 1, "idempotent");
  assert.equal((await admin("/admin/eco-credits/expire", { method: "POST" })).status, 200);
  assert.equal((await wallet(buyer)).balance, 50);
  assert.ok((await admin("/admin/eco-credits/overview")).body.data.totals.expired >= 180);
  await admin("/admin/eco-credits/settings", { method: "PUT", body: { creditExpiryEnabled: false } });
});

test("admin dashboard + ledger filters: type, customer, date range, material, request id", async () => {
  const rule = await makeRule({ material: `Filter ${rnd()}`, creditsPerUnit: 3 });
  const buyer = await registerBuyer();
  const req = (await submit(buyer, rule, 7)).body.data;
  await receiveAndVerify(req.id, rule, 7);
  await step(req.id, "approve");

  const tx = async (qs) => (await admin(`/admin/eco-credits/transactions?${qs}`)).body.data;
  const byMaterial = await tx(`material=${encodeURIComponent(rule.material)}`);
  assert.equal(byMaterial.total, 1);
  assert.equal(byMaterial.transactions[0].amount, 21);
  assert.equal(byMaterial.transactions[0].request.requestNumber, req.requestNumber);
  assert.equal(byMaterial.transactions[0].request.creditsPerUnit, 3);
  assert.equal(byMaterial.transactions[0].customer.email, buyer.email);
  assert.equal((await tx(`requestNumber=${req.requestNumber}`)).total, 1);
  assert.equal((await tx(`customer=${encodeURIComponent(buyer.email)}&type=RECYCLING_REWARD`)).total, 1);
  assert.equal((await tx(`customer=${encodeURIComponent(buyer.email)}&type=REDEMPTION`)).total, 0);
  assert.equal((await tx(`userId=${buyer.userId}&from=${new Date(Date.now() + 3600_000).toISOString()}`)).total, 0);
  assert.equal((await tx(`userId=${buyer.userId}&to=${new Date(Date.now() + 3600_000).toISOString()}`)).total, 1);

  const dash = (await admin("/admin/eco-credits/overview")).body.data;
  for (const k of ["issued", "redeemed", "expired", "outstanding"]) assert.equal(typeof dash.totals[k], "number", k);
  assert.ok(dash.requests.approved >= 1);
  assert.equal(typeof dash.requests.pending, "number");
  assert.ok(dash.recent.length > 0);

  const list = (await admin(`/admin/recycling/requests?status=APPROVED&q=${req.requestNumber}`)).body.data;
  assert.equal(list.requests.length, 1);
  assert.deepEqual([list.requests[0].estimatedQuantity, list.requests[0].verifiedQuantity, list.requests[0].creditsAwarded, list.requests[0].customer.email], [7, 7, 21, buyer.email]);
  const over = (await admin("/admin/recycling/overview")).body.data;
  assert.ok(over.recycling.approved >= 1);
  assert.equal(typeof over.productReturns.total, "number");
});

test("TEST 23: every admin action leaves an audit record", async () => {
  const events = await prisma.auditLog.findMany({ where: { createdAt: { gte: STARTED } }, select: { eventType: true } });
  const seen = new Set(events.map((e) => e.eventType));
  for (const type of [
    "recycling_rule.created", "recycling_rule.changed", "recycling_rule.disabled", "recycling_rule.enabled", "recycling_rule.archived",
    "recycling.submitted", "recycling.approved", "recycling.rejected", "eco_credits.awarded", "eco_credits.adjusted",
    "eco_credits.redeemed", "coupon.generated", "coupon.revoked", "eco_credits.expired", "eco_rewards.settings_updated",
  ]) assert.ok(seen.has(type), `missing audit event ${type}`);
  const changed = await prisma.auditLog.findFirst({ where: { eventType: "recycling_rule.changed", createdAt: { gte: STARTED } }, orderBy: { createdAt: "desc" } });
  assert.equal(typeof changed.metadata.creditsPerUnitBefore, "number");
  assert.ok(changed.actorId, "the acting admin is recorded");
});

test("security: customers only touch their own data; every admin endpoint needs the admin role", async () => {
  const rule = await makeRule();
  const owner = await registerBuyer();
  const other = await registerBuyer();
  const seller = await registerSeller();
  const req = (await submit(owner, rule, 5)).body.data;

  // Another customer cannot see, cancel or attach to it.
  assert.equal((await api(`/recycling/requests/${req.id}`, { token: other.token })).status, 404);
  assert.equal((await api(`/recycling/requests/${req.id}/cancel`, { method: "POST", token: other.token })).status, 404);
  assert.equal((await api(`/recycling/requests/${req.id}/files`, { method: "POST", token: other.token, body: { fileName: "a.png", mime: "image/png", dataBase64: PNG_B64 } })).status, 404);
  assert.ok(!(await api("/recycling/requests", { token: other.token })).body.data.requests.some((r) => r.id === req.id));
  // A customer cannot use someone else's address.
  assert.equal((await api("/recycling/requests", { method: "POST", token: other.token, body: { material: rule.material, unit: "kg", estimatedQuantity: 2, pickupAddressId: owner.addressId } })).status, 400);

  const adminOnly = [
    ["GET", "/admin/recycling/overview"], ["GET", "/admin/recycling/rules"], ["POST", "/admin/recycling/rules"],
    ["PATCH", `/admin/recycling/rules/${rule.id}`], ["POST", `/admin/recycling/rules/${rule.id}/deactivate`], ["DELETE", `/admin/recycling/rules/${rule.id}`],
    ["GET", "/admin/recycling/requests"], ["GET", `/admin/recycling/requests/${req.id}`],
    ["POST", `/admin/recycling/requests/${req.id}/received`], ["POST", `/admin/recycling/requests/${req.id}/verify`],
    ["POST", `/admin/recycling/requests/${req.id}/approve`], ["POST", `/admin/recycling/requests/${req.id}/reject`],
    ["GET", "/admin/eco-credits/overview"], ["GET", "/admin/eco-credits/transactions"], ["GET", `/admin/eco-credits/customers/${other.userId}`],
    ["POST", "/admin/eco-credits/adjustments"], ["POST", "/admin/eco-credits/expire"], ["POST", "/admin/eco-credits/coupons/x/revoke"],
    ["GET", "/admin/eco-credits/settings"], ["PUT", "/admin/eco-credits/settings"],
  ];
  for (const [method, path] of adminOnly) {
    const body = method === "GET" ? undefined : { userId: owner.userId, direction: "credit", amount: 1_000_000, reason: "self-service", verifiedQuantity: 99, ruleId: rule.id, creditsPerUnit: 999 };
    for (const token of [owner.token, seller.token]) assert.equal((await api(path, { method, token, body })).status, 403, `${method} ${path}`);
    assert.equal((await api(path, { method, body })).status, 401, `${method} ${path} anonymous`);
  }
  for (const [method, path] of [["GET", "/eco-credits"], ["POST", "/eco-credits/redeem"], ["GET", "/eco-credits/coupons"], ["GET", "/recycling/requests"], ["POST", "/recycling/requests"]]) {
    assert.equal((await api(path, { method, body: method === "GET" ? undefined : {} })).status, 401, `${method} ${path} anonymous`);
  }
  assert.equal((await api("/recycling/program")).status, 200, "the programme description is public");

  // Nothing above moved a credit or changed the request/rule.
  assert.equal((await wallet(owner)).balance, 0);
  assert.equal((await api(`/recycling/requests/${req.id}`, { token: owner.token })).body.data.status, "PENDING");
  assert.equal((await admin("/admin/recycling/rules")).body.data.rules.find((r) => r.id === rule.id).creditsPerUnit, 10);

  // The owner may cancel while it is still pending — and only then.
  assert.equal((await api(`/recycling/requests/${req.id}/cancel`, { method: "POST", token: owner.token })).body.data.status, "CANCELLED");
  assert.equal((await step(req.id, "received")).status, 409);
});
