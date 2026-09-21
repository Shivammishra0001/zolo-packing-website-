// Eco Credits — the ledger, the customer wallet, manual adjustments, Eco Reward
// settings and redemption into a customer-specific coupon.
//
// INVARIANTS
//  - The ledger (EcoCreditTransaction) is append-only. A balance is never
//    "set": every change is a row, written through postTransaction() below,
//    which serialises writers per customer and refuses to go below zero.
//  - balance(user) = newest row's balanceAfter = SUM(amount). ledgerHealth()
//    proves that for every customer.
//  - No credit value, conversion rate or expiry rule lives in code. Everything
//    comes from RecyclingRule rows and the EcoRewardSetting row.
//  - Redemption does NOT have its own coupon engine: it creates a row in the
//    existing Coupon table (source = eco_reward, assignedUserId = the customer)
//    and the existing checkout validation does the rest.
import { randomInt } from "node:crypto";
import { z, ZodError } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { couponStatus } from "../lib/commerce.mjs";
import { recordEvent, notify } from "./events.mjs";

export const ECO_CREDIT_TYPES = ["RECYCLING_REWARD", "REDEMPTION", "MANUAL_CREDIT", "MANUAL_DEBIT", "REVERSAL", "EXPIRATION"];

const issue = (path, message) => new ZodError([{ code: "custom", path: [path], message }]);
const inr = (minor) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const displayName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null);

// ---------------------------------------------------------------------------
// Ledger primitive
// ---------------------------------------------------------------------------

/**
 * Append one ledger row. MUST be called inside a transaction. A per-customer
 * advisory lock makes read-balance → write-row atomic, so two concurrent
 * writers can never both build on the same "last balance".
 */
export async function postTransaction(tx, { userId, type, amount, source = null, referenceId = null, description = null, reason = null, adminNote = null, createdById = null }) {
  if (!Number.isInteger(amount) || amount === 0) throw badRequest("Eco Credit amount must be a non-zero whole number", "BAD_AMOUNT");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`eco-credits:${userId}`}))`;
  const last = await tx.ecoCreditTransaction.findFirst({ where: { userId }, orderBy: { seq: "desc" }, select: { balanceAfter: true } });
  const balanceAfter = (last?.balanceAfter ?? 0) + amount;
  if (balanceAfter < 0) throw badRequest("Not enough Eco Credits", "INSUFFICIENT_CREDITS");
  return tx.ecoCreditTransaction.create({
    data: { userId, type, amount, balanceAfter, source, referenceId, description, reason, adminNote, createdById },
  });
}

export async function balanceOf(userId, tx = prisma) {
  const last = await tx.ecoCreditTransaction.findFirst({ where: { userId }, orderBy: { seq: "desc" }, select: { balanceAfter: true } });
  return last?.balanceAfter ?? 0;
}

// ---------------------------------------------------------------------------
// Eco Reward settings (singleton row)
// ---------------------------------------------------------------------------

const optPositive = (max) => z.number().int().min(1).max(max).nullable().optional();
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  minCreditsToRedeem: optPositive(100_000_000),
  creditsRequired: optPositive(100_000_000),
  couponValueMinor: optPositive(1_000_000_000),
  couponValidityDays: optPositive(3650),
  couponMinOrderMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  couponUsageLimit: z.number().int().min(1).max(1000).optional(),
  maxUnitsPerRedemption: z.number().int().min(1).max(1000).optional(),
  allowCombine: z.boolean().optional(),
  appliesTo: z.enum(["all", "products", "categories"]).optional(),
  productIds: z.array(z.string().min(1)).max(500).optional(),
  categoryIds: z.array(z.string().min(1)).max(200).optional(),
  creditExpiryEnabled: z.boolean().optional(),
  creditExpiryDays: optPositive(36500),
}).strict();

/** The row is created DISABLED and empty — there are no built-in values. */
export const getSettingsRow = (tx = prisma) =>
  tx.ecoRewardSetting.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

/** Rewards can be redeemed only when switched on AND fully configured. */
export const rewardReady = (s) =>
  Boolean(s.enabled && s.creditsRequired > 0 && s.couponValueMinor > 0 && s.couponValidityDays > 0);

async function shapeSettings(s) {
  const [products, categories] = await Promise.all([
    s.productIds.length ? prisma.product.findMany({ where: { id: { in: s.productIds } }, select: { id: true, name: true, sku: true } }) : [],
    s.categoryIds.length ? prisma.category.findMany({ where: { id: { in: s.categoryIds } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    enabled: s.enabled,
    minCreditsToRedeem: s.minCreditsToRedeem,
    creditsRequired: s.creditsRequired,
    couponValueMinor: s.couponValueMinor,
    couponValidityDays: s.couponValidityDays,
    couponMinOrderMinor: s.couponMinOrderMinor,
    couponUsageLimit: s.couponUsageLimit,
    maxUnitsPerRedemption: s.maxUnitsPerRedemption,
    allowCombine: s.allowCombine,
    appliesTo: s.appliesTo,
    productIds: s.productIds,
    categoryIds: s.categoryIds,
    products,
    categories,
    creditExpiryEnabled: s.creditExpiryEnabled,
    creditExpiryDays: s.creditExpiryDays,
    ready: rewardReady(s),
    updatedAt: s.updatedAt,
  };
}

export const getSettings = async () => shapeSettings(await getSettingsRow());

export async function updateSettings(adminId, body) {
  const patch = settingsSchema.parse(body);
  const current = await getSettingsRow();
  const next = { ...current, ...patch };

  if (next.enabled) {
    if (!next.creditsRequired) throw issue("creditsRequired", "Enter the credits needed for one reward");
    if (!next.couponValueMinor) throw issue("couponValueMinor", "Enter the coupon value");
    if (!next.couponValidityDays) throw issue("couponValidityDays", "Enter how many days the coupon stays valid");
  }
  if (next.minCreditsToRedeem && next.creditsRequired && next.minCreditsToRedeem < next.creditsRequired) {
    throw issue("minCreditsToRedeem", "Cannot be lower than the credits required for one reward");
  }
  if (next.creditExpiryEnabled && !next.creditExpiryDays) throw issue("creditExpiryDays", "Enter the number of days before credits expire");
  if (next.appliesTo === "products") {
    if (!next.productIds.length) throw issue("productIds", "Select at least one product");
    const n = await prisma.product.count({ where: { id: { in: next.productIds }, deletedAt: null } });
    if (n !== new Set(next.productIds).size) throw issue("productIds", "One or more selected products no longer exist");
  }
  if (next.appliesTo === "categories") {
    if (!next.categoryIds.length) throw issue("categoryIds", "Select at least one category");
    const n = await prisma.category.count({ where: { id: { in: next.categoryIds }, deletedAt: null } });
    if (n !== new Set(next.categoryIds).size) throw issue("categoryIds", "One or more selected categories no longer exist");
  }

  const data = { ...patch, updatedById: adminId };
  if (next.appliesTo !== "products") data.productIds = [];
  if (next.appliesTo !== "categories") data.categoryIds = [];
  const saved = await prisma.ecoRewardSetting.update({ where: { id: "default" }, data });
  await recordEvent({
    eventType: "eco_rewards.settings_updated", actorId: adminId, entityType: "EcoRewardSetting", entityId: "default",
    metadata: { fields: Object.keys(patch), enabled: saved.enabled, creditsRequired: saved.creditsRequired, couponValueMinor: saved.couponValueMinor },
  });
  return shapeSettings(saved);
}

/** What customers may know about the reward — no internals. */
export function publicReward(s) {
  const ready = rewardReady(s);
  return {
    enabled: ready,
    creditsRequired: ready ? s.creditsRequired : null,
    couponValueMinor: ready ? s.couponValueMinor : null,
    couponValidityDays: ready ? s.couponValidityDays : null,
    couponMinOrderMinor: ready ? s.couponMinOrderMinor : null,
    minCreditsToRedeem: ready ? Math.max(s.minCreditsToRedeem ?? 0, s.creditsRequired) : null,
    maxUnitsPerRedemption: ready ? s.maxUnitsPerRedemption : null,
    appliesTo: ready ? s.appliesTo : null,
    creditExpiryDays: s.creditExpiryEnabled ? s.creditExpiryDays : null,
  };
}

// ---------------------------------------------------------------------------
// Expiry (only when the admin enabled it)
// ---------------------------------------------------------------------------

/**
 * FIFO expiry: debits always consume the OLDEST credits first, so the credits
 * that are still unspent AND older than the cutoff are
 *     earned-before-cutoff  −  everything ever debited.
 * Posting the EXPIRATION row raises "ever debited", so running this twice is a
 * no-op. Nothing is deleted — expiry is a ledger row like any other.
 */
export async function expireForUser(tx, userId, settings, now = new Date()) {
  if (!settings.creditExpiryEnabled || !settings.creditExpiryDays) return 0;
  const cutoff = new Date(now.getTime() - settings.creditExpiryDays * 86_400_000);
  const [earned, debited] = await Promise.all([
    tx.ecoCreditTransaction.aggregate({ where: { userId, amount: { gt: 0 }, createdAt: { lt: cutoff } }, _sum: { amount: true } }),
    tx.ecoCreditTransaction.aggregate({ where: { userId, amount: { lt: 0 } }, _sum: { amount: true } }),
  ]);
  const stale = (earned._sum.amount ?? 0) + (debited._sum.amount ?? 0); // debits are negative
  if (stale <= 0) return 0;
  const expiring = Math.min(stale, await balanceOf(userId, tx));
  if (expiring <= 0) return 0;
  await postTransaction(tx, {
    userId, type: "EXPIRATION", amount: -expiring, source: "system",
    description: `Expired — unused for ${settings.creditExpiryDays} days`,
  });
  await recordEvent({ eventType: "eco_credits.expired", entityType: "User", entityId: userId, metadata: { credits: expiring, days: settings.creditExpiryDays } }, tx);
  return expiring;
}

/** Admin "run expiry now": sweeps every customer that holds credits. */
export async function runExpiry(adminId) {
  const settings = await getSettingsRow();
  if (!settings.creditExpiryEnabled || !settings.creditExpiryDays) {
    throw conflict("Credit expiry is switched off in Eco Reward Settings", "EXPIRY_DISABLED");
  }
  const holders = await prisma.ecoCreditTransaction.findMany({ distinct: ["userId"], select: { userId: true } });
  let customers = 0; let credits = 0;
  for (const { userId } of holders) {
    const expired = await prisma.$transaction((tx) => expireForUser(tx, userId, settings));
    if (expired > 0) { customers += 1; credits += expired; }
  }
  await recordEvent({ eventType: "eco_credits.expiry_run", actorId: adminId, entityType: "EcoRewardSetting", entityId: "default", metadata: { customers, credits } });
  return { customers, credits };
}

// ---------------------------------------------------------------------------
// Customer wallet
// ---------------------------------------------------------------------------

const shapeTx = (t) => ({
  id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, source: t.source, referenceId: t.referenceId,
  description: t.description ?? t.reason ?? null, createdAt: t.createdAt,
});

function shapeRewardCoupon(c, now = new Date()) {
  const base = couponStatus(c, now);
  const status = c.deletedAt ? "revoked" : base === "usage_limit_reached" ? "used" : base;
  return {
    id: c.id, code: c.code, name: c.name, valueMinor: c.discountValue, minOrderMinor: c.minOrderMinor,
    expiresAt: c.validUntil, usageLimit: c.usageLimit, usageCount: c.usedCount, status, createdAt: c.createdAt,
  };
}

export async function wallet(userId) {
  const settings = await getSettingsRow();
  // Lazy expiry keeps the balance truthful without a scheduler.
  await prisma.$transaction((tx) => expireForUser(tx, userId, settings));
  const [rows, coupons] = await Promise.all([
    prisma.ecoCreditTransaction.findMany({ where: { userId }, orderBy: { seq: "desc" }, take: 200 }),
    prisma.coupon.findMany({ where: { assignedUserId: userId, source: "eco_reward" }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const balance = rows[0]?.balanceAfter ?? 0;
  const reward = publicReward(settings);
  const maxUnits = reward.enabled && balance >= reward.minCreditsToRedeem
    ? Math.min(Math.floor(balance / reward.creditsRequired), reward.maxUnitsPerRedemption)
    : 0;
  return {
    balance,
    transactions: rows.map(shapeTx),
    // Kept for the storefront Eco Wallet, which reads `ledger`.
    ledger: rows.map(shapeTx),
    reward: { ...reward, redeemableUnits: maxUnits },
    coupons: coupons.map((c) => shapeRewardCoupon(c)),
  };
}

export async function myRewardCoupons(userId) {
  const coupons = await prisma.coupon.findMany({ where: { assignedUserId: userId, source: "eco_reward" }, orderBy: { createdAt: "desc" }, take: 100 });
  return { coupons: coupons.map((c) => shapeRewardCoupon(c)) };
}

// ---------------------------------------------------------------------------
// Redemption: credits -> customer-specific coupon (one transaction)
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const newRewardCode = () => `ECO-${Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")}`;

export async function redeem(userId, body = {}) {
  const units = body.units === undefined ? 1 : Number(body.units);
  if (!Number.isInteger(units) || units < 1) throw badRequest("Choose how many rewards to redeem", "BAD_UNITS");

  const result = await prisma.$transaction(async (tx) => {
    const settings = await getSettingsRow(tx);
    if (!rewardReady(settings)) throw conflict("Eco Rewards are not available right now", "REWARDS_DISABLED");
    if (units > settings.maxUnitsPerRedemption) {
      throw badRequest(`You can combine at most ${settings.maxUnitsPerRedemption} reward(s) into one coupon`, "TOO_MANY_UNITS");
    }
    await expireForUser(tx, userId, settings);

    const cost = units * settings.creditsRequired;
    const valueMinor = units * settings.couponValueMinor;
    const balance = await balanceOf(userId, tx);
    const floor = Math.max(settings.minCreditsToRedeem ?? 0, cost);
    if (balance < floor) {
      throw badRequest(`You need ${floor.toLocaleString("en-IN")} Eco Credits to redeem — you have ${balance.toLocaleString("en-IN")}`, "INSUFFICIENT_CREDITS");
    }

    // Targets that were deleted since the settings were saved are dropped; if
    // none remain the redemption is refused rather than silently widened.
    const productIds = settings.appliesTo === "products"
      ? (await tx.product.findMany({ where: { id: { in: settings.productIds }, deletedAt: null }, select: { id: true } })).map((p) => p.id) : [];
    const categoryIds = settings.appliesTo === "categories"
      ? (await tx.category.findMany({ where: { id: { in: settings.categoryIds }, deletedAt: null }, select: { id: true } })).map((c) => c.id) : [];
    if ((settings.appliesTo === "products" && !productIds.length) || (settings.appliesTo === "categories" && !categoryIds.length)) {
      throw conflict("Eco Rewards are not available right now", "REWARDS_MISCONFIGURED");
    }

    let code = newRewardCode();
    for (let i = 0; i < 5 && (await tx.coupon.findUnique({ where: { code }, select: { id: true } })); i++) code = newRewardCode();

    const now = new Date();
    const coupon = await tx.coupon.create({
      data: {
        code,
        name: `Eco Reward — ${inr(valueMinor)} off`,
        description: `Redeemed for ${cost} Eco Credits`,
        discountType: "flat",
        discountValue: valueMinor,
        minOrderMinor: settings.couponMinOrderMinor ?? null,
        usageLimit: settings.couponUsageLimit,
        usageLimitPerCustomer: settings.couponUsageLimit,
        validFrom: now,
        validUntil: new Date(now.getTime() + settings.couponValidityDays * 86_400_000),
        isActive: true,
        isDraft: false,
        appliesTo: settings.appliesTo,
        allowSaleItems: true,
        allowOtherDiscounts: settings.allowCombine,
        source: "eco_reward",
        assignedUserId: userId,
        products: productIds.length ? { create: productIds.map((productId) => ({ productId })) } : undefined,
        categories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
      },
    });
    // The debit comes AFTER the coupon exists and in the same transaction: if
    // either write fails, both roll back — no lost credits, no free coupon.
    const entry = await postTransaction(tx, {
      userId, type: "REDEMPTION", amount: -cost, source: "Coupon", referenceId: coupon.id,
      description: `Redeemed ${inr(valueMinor)} coupon (${code})`,
    });
    await recordEvent({ eventType: "eco_credits.redeemed", actorId: userId, entityType: "User", entityId: userId, metadata: { credits: cost, units, couponCode: code } }, tx);
    await recordEvent({ eventType: "coupon.generated", actorId: userId, entityType: "Coupon", entityId: coupon.id, metadata: { code, source: "eco_reward", valueMinor, credits: cost } }, tx);
    return { coupon, entry, cost };
  });

  try {
    await notify({ userId, type: "eco_credits.redeemed", title: "Eco Reward coupon ready", body: `${result.coupon.code} — ${inr(result.coupon.discountValue)} off. Use it at checkout.`, entityType: "Coupon", entityId: result.coupon.id });
  } catch (e) { console.error("[eco-credits] notification failed:", e.message); }
  return { coupon: shapeRewardCoupon(result.coupon), creditsSpent: result.cost, balance: result.entry.balanceAfter };
}

// ---------------------------------------------------------------------------
// Admin: adjustments, reversal, dashboard
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  userId: z.string().min(1),
  direction: z.enum(["credit", "debit"]),
  amount: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(3, "A reason is required").max(300),
  adminNote: z.string().trim().max(1000).nullable().optional(),
}).strict();

/** Manual correction. ALWAYS a ledger row with a reason — never a silent edit. */
export async function manualAdjustment(adminId, body) {
  const v = adjustSchema.parse(body);
  const user = await prisma.user.findUnique({ where: { id: v.userId }, select: { id: true } });
  if (!user) throw notFound("Customer not found");
  const entry = await prisma.$transaction(async (tx) => {
    const row = await postTransaction(tx, {
      userId: v.userId,
      type: v.direction === "credit" ? "MANUAL_CREDIT" : "MANUAL_DEBIT",
      amount: v.direction === "credit" ? v.amount : -v.amount,
      source: "manual", description: `Admin adjustment — ${v.reason}`, reason: v.reason, adminNote: v.adminNote || null, createdById: adminId,
    });
    await recordEvent({
      eventType: "eco_credits.adjusted", actorId: adminId, entityType: "User", entityId: v.userId,
      metadata: { direction: v.direction, credits: v.amount, reason: v.reason, balanceAfter: row.balanceAfter, transactionId: row.id },
    }, tx);
    return row;
  });
  try {
    await notify({ userId: v.userId, type: "eco_credits.adjusted", title: "Eco Credits updated", body: `${entry.amount > 0 ? "+" : ""}${entry.amount} Eco Credits — ${v.reason}`, entityType: "User", entityId: v.userId });
  } catch (e) { console.error("[eco-credits] notification failed:", e.message); }
  return { transaction: shapeAdminTx({ ...entry, user: null }), balance: entry.balanceAfter };
}

/** Revoke an UNUSED Eco Reward coupon and hand the credits back (REVERSAL). */
export async function revokeRewardCoupon(adminId, couponId, { reason } = {}) {
  const why = String(reason ?? "").trim();
  if (why.length < 3) throw issue("reason", "A reason is required");
  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.findFirst({ where: { id: couponId, source: "eco_reward" } });
    if (!coupon) throw notFound("Eco Reward coupon not found");
    if (coupon.deletedAt) throw conflict("This coupon was already revoked", "ALREADY_REVOKED");
    if (coupon.usedCount > 0) throw conflict("This coupon has already been used and cannot be reversed", "COUPON_USED");
    const redemption = await tx.ecoCreditTransaction.findFirst({ where: { type: "REDEMPTION", source: "Coupon", referenceId: coupon.id } });
    await tx.coupon.update({ where: { id: coupon.id }, data: { deletedAt: new Date(), isActive: false } });
    let balance = await balanceOf(coupon.assignedUserId, tx);
    if (redemption && coupon.assignedUserId) {
      const row = await postTransaction(tx, {
        userId: coupon.assignedUserId, type: "REVERSAL", amount: Math.abs(redemption.amount), source: "Coupon", referenceId: coupon.id,
        description: `Coupon ${coupon.code} revoked — credits returned`, reason: why, createdById: adminId,
      });
      balance = row.balanceAfter;
    }
    await recordEvent({ eventType: "coupon.revoked", actorId: adminId, entityType: "Coupon", entityId: coupon.id, metadata: { code: coupon.code, reason: why, creditsReturned: redemption ? Math.abs(redemption.amount) : 0 } }, tx);
    return { id: coupon.id, code: coupon.code, revoked: true, creditsReturned: redemption ? Math.abs(redemption.amount) : 0, balance };
  });
}

function shapeAdminTx(t, requests = new Map(), coupons = new Map()) {
  const request = t.source === "RecyclingRequest" ? requests.get(t.referenceId) ?? null : null;
  const coupon = t.source === "Coupon" ? coupons.get(t.referenceId) ?? null : null;
  return {
    id: t.id, seq: t.seq, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter, source: t.source, referenceId: t.referenceId,
    description: t.description, reason: t.reason, adminNote: t.adminNote, createdById: t.createdById, createdAt: t.createdAt,
    customer: t.user ? { id: t.user.id, name: displayName(t.user), email: t.user.email } : null,
    request, coupon,
  };
}

/** Ledger search: customer, type, date range, material, request id. */
export async function listTransactions({ userId, customer, type, from, to, material, requestNumber, take = 50, skip = 0 } = {}) {
  const where = {};
  if (userId) where.userId = String(userId);
  if (type && ECO_CREDIT_TYPES.includes(type)) where.type = type;
  const q = String(customer ?? "").trim();
  if (q) {
    where.user = { OR: [{ email: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] };
  }
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
    where.createdAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) where.createdAt.gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) where.createdAt.lte = toDate;
  }
  const mat = String(material ?? "").trim();
  const num = String(requestNumber ?? "").trim();
  if (mat || num) {
    const matches = await prisma.recyclingRequest.findMany({
      where: {
        ...(mat ? { material: { equals: mat, mode: "insensitive" } } : {}),
        ...(num ? { requestNumber: { contains: num, mode: "insensitive" } } : {}),
      },
      select: { id: true }, take: 2000,
    });
    where.source = "RecyclingRequest";
    where.referenceId = { in: matches.map((m) => m.id) };
  }

  const limit = Math.min(Math.max(Number(take) || 50, 1), 200);
  const [rows, total] = await Promise.all([
    prisma.ecoCreditTransaction.findMany({
      where, orderBy: { seq: "desc" }, take: limit, skip: Math.max(Number(skip) || 0, 0),
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }),
    prisma.ecoCreditTransaction.count({ where }),
  ]);
  const requestIds = rows.filter((r) => r.source === "RecyclingRequest" && r.referenceId).map((r) => r.referenceId);
  const couponIds = rows.filter((r) => r.source === "Coupon" && r.referenceId).map((r) => r.referenceId);
  const [reqs, cps] = await Promise.all([
    requestIds.length ? prisma.recyclingRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, requestNumber: true, ruleMaterial: true, ruleUnit: true, verifiedQuantityMilli: true, ruleCreditsPerUnitX100: true } }) : [],
    couponIds.length ? prisma.coupon.findMany({ where: { id: { in: couponIds } }, select: { id: true, code: true, discountValue: true, usedCount: true, deletedAt: true, validUntil: true } }) : [],
  ]);
  const requests = new Map(reqs.map((r) => [r.id, {
    id: r.id, requestNumber: r.requestNumber, material: r.ruleMaterial, unit: r.ruleUnit,
    verifiedQuantity: r.verifiedQuantityMilli != null ? r.verifiedQuantityMilli / 1000 : null,
    creditsPerUnit: r.ruleCreditsPerUnitX100 != null ? r.ruleCreditsPerUnitX100 / 100 : null,
  }]));
  const coupons = new Map(cps.map((c) => [c.id, { id: c.id, code: c.code, valueMinor: c.discountValue, used: c.usedCount > 0, revoked: Boolean(c.deletedAt), expiresAt: c.validUntil }]));
  return { transactions: rows.map((t) => shapeAdminTx(t, requests, coupons)), total };
}

/** Every customer's newest balanceAfter must equal the sum of their rows. */
export async function ledgerHealth() {
  const broken = await prisma.$queryRaw`
    SELECT t."userId"
    FROM "EcoCreditTransaction" t
    JOIN (SELECT "userId", MAX("seq") AS last_seq, SUM("amount") AS total FROM "EcoCreditTransaction" GROUP BY "userId") s
      ON s."userId" = t."userId" AND s.last_seq = t."seq"
    WHERE t."balanceAfter" <> s.total`;
  return { reconciled: broken.length === 0, mismatchedCustomers: broken.length };
}

export async function dashboard() {
  const sum = async (where) => (await prisma.ecoCreditTransaction.aggregate({ where, _sum: { amount: true } }))._sum.amount ?? 0;
  const [issued, redeemed, reversed, expired, outstanding, pending, approved, rejected, health, recent, settings] = await Promise.all([
    sum({ type: { in: ["RECYCLING_REWARD", "MANUAL_CREDIT"] } }),
    sum({ type: "REDEMPTION" }),
    sum({ type: "REVERSAL" }),
    sum({ type: "EXPIRATION" }),
    sum({}),
    prisma.recyclingRequest.count({ where: { status: { in: ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION"] } } }),
    prisma.recyclingRequest.count({ where: { status: "APPROVED" } }),
    prisma.recyclingRequest.count({ where: { status: "REJECTED" } }),
    ledgerHealth(),
    listTransactions({ take: 10 }),
    getSettingsRow(),
  ]);
  return {
    totals: {
      issued, redeemed: Math.abs(redeemed) - reversed > 0 ? Math.abs(redeemed) - reversed : 0, expired: Math.abs(expired),
      manualDebited: Math.abs(await sum({ type: "MANUAL_DEBIT" })), outstanding,
    },
    requests: { pending, approved, rejected },
    ledger: health,
    expiry: { enabled: settings.creditExpiryEnabled, days: settings.creditExpiryDays },
    recent: recent.transactions,
  };
}

/** One customer's balance + history, for the admin. */
export async function customerLedger(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true } });
  if (!user) throw notFound("Customer not found");
  const [list, coupons] = await Promise.all([
    listTransactions({ userId, take: 200 }),
    prisma.coupon.findMany({ where: { assignedUserId: userId, source: "eco_reward" }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return {
    customer: { id: user.id, name: displayName(user), email: user.email },
    balance: await balanceOf(userId),
    transactions: list.transactions,
    coupons: coupons.map((c) => shapeRewardCoupon(c)),
  };
}

/** Customer search for the manual-adjustment form. */
export async function searchCustomers(q) {
  const term = String(q ?? "").trim();
  if (term.length < 2) return { customers: [] };
  const users = await prisma.user.findMany({
    where: { OR: [{ email: { contains: term, mode: "insensitive" } }, { firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] },
    select: { id: true, email: true, firstName: true, lastName: true }, take: 10, orderBy: { createdAt: "desc" },
  });
  const customers = await Promise.all(users.map(async (u) => ({ id: u.id, name: displayName(u), email: u.email, balance: await balanceOf(u.id) })));
  return { customers };
}
