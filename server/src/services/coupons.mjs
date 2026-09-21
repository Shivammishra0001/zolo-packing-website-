// Coupon management (admin). Pricing/validation of a coupon against a cart
// lives in lib/commerce.mjs + services/orders.mjs (checkCoupon) — this module
// only owns the coupon RECORDS: create / edit / pause / duplicate / archive.
//
// Conventions kept from the rest of the API:
//  - money is integer paise; a percentage is stored as basis points (1000 = 10%)
//  - the effective status is DERIVED (couponStatus), never stored
//  - nothing is hard-deleted: "archive" sets deletedAt so order history and the
//    redemption ledger stay intact
import { z, ZodError } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { couponStatus } from "../lib/commerce.mjs";
import { recordEvent } from "./events.mjs";

/** welcome10 / Welcome10 / " WELCOME10 " all resolve to the same code. */
export const normalizeCouponCode = (code) => String(code ?? "").trim().toUpperCase();

const optMinor = z.number().int().min(0).max(1_000_000_000).nullable().optional();
const optCount = z.number().int().min(1).max(10_000_000).nullable().optional();
const isoDate = z.string().datetime({ offset: true }).transform((v) => new Date(v));

const couponFields = {
  code: z.string().trim().min(3, "Code needs at least 3 characters").max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - and _ only")
    .transform(normalizeCouponCode),
  name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  discountType: z.enum(["percent", "flat"]),
  // percent → basis points (1..10000); flat → paise
  discountValue: z.number().int().min(1),
  maxDiscountMinor: optMinor,
  minOrderMinor: optMinor,
  usageLimit: optCount,
  usageLimitPerCustomer: optCount,
  startAt: isoDate,
  endAt: isoDate,
  isActive: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  appliesTo: z.enum(["all", "products", "categories"]).optional(),
  productIds: z.array(z.string().min(1)).max(500).optional(),
  categoryIds: z.array(z.string().min(1)).max(200).optional(),
  allowSaleItems: z.boolean().optional(),
  allowOtherDiscounts: z.boolean().optional(),
};
const createSchema = z.object(couponFields).strict();
const updateSchema = z.object(couponFields).partial().strict();

const include = {
  products: { include: { product: { select: { id: true, name: true, sku: true } } } },
  categories: { include: { category: { select: { id: true, name: true, parentId: true } } } },
  _count: { select: { redemptions: true } },
};

/** API shape. Dates/usage use the public names (startAt / endAt / usageCount). */
export function shapeCoupon(c, now = new Date()) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxDiscountMinor: c.maxDiscountMinor,
    minOrderMinor: c.minOrderMinor,
    usageLimit: c.usageLimit,
    usageCount: c.usedCount,
    usageLimitPerCustomer: c.usageLimitPerCustomer,
    startAt: c.validFrom,
    endAt: c.validUntil,
    isActive: c.isActive,
    isDraft: c.isDraft,
    appliesTo: c.appliesTo,
    allowSaleItems: c.allowSaleItems,
    allowOtherDiscounts: c.allowOtherDiscounts,
    products: (c.products ?? []).map((r) => r.product).filter(Boolean),
    categories: (c.categories ?? []).map((r) => r.category).filter(Boolean),
    redemptions: c._count?.redemptions ?? 0,
    status: couponStatus(c, now),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Cross-field rules that a per-field schema cannot express. */
function assertCoherent(v) {
  const issues = [];
  if (v.discountType === "percent" && v.discountValue > 10_000) {
    issues.push({ path: "discountValue", message: "A percentage cannot exceed 100%" });
  }
  if (v.startAt && v.endAt && v.endAt <= v.startAt) {
    issues.push({ path: "endAt", message: "End must be after the start" });
  }
  if (v.appliesTo === "products" && !(v.productIds?.length)) {
    issues.push({ path: "productIds", message: "Select at least one product" });
  }
  if (v.appliesTo === "categories" && !(v.categoryIds?.length)) {
    issues.push({ path: "categoryIds", message: "Select at least one category" });
  }
  if (v.usageLimit != null && v.usageLimitPerCustomer != null && v.usageLimitPerCustomer > v.usageLimit) {
    issues.push({ path: "usageLimitPerCustomer", message: "Cannot exceed the total usage limit" });
  }
  // Raised as a ZodError so the client gets the same field-level `issues`
  // envelope as any other validation failure.
  if (issues.length) throw new ZodError(issues.map((i) => ({ code: "custom", path: [i.path], message: i.message })));
}

/** Selected products/categories must be real rows — never trust ids blindly. */
async function assertTargetsExist(tx, { productIds, categoryIds }) {
  if (productIds?.length) {
    const n = await tx.product.count({ where: { id: { in: productIds }, deletedAt: null } });
    if (n !== new Set(productIds).size) throw badRequest("One or more selected products no longer exist", "PRODUCT_NOT_FOUND");
  }
  if (categoryIds?.length) {
    const n = await tx.category.count({ where: { id: { in: categoryIds }, deletedAt: null } });
    if (n !== new Set(categoryIds).size) throw badRequest("One or more selected categories no longer exist", "CATEGORY_NOT_FOUND");
  }
}

const toRow = (v) => {
  const data = {};
  const map = {
    code: "code", name: "name", description: "description", discountType: "discountType",
    discountValue: "discountValue", maxDiscountMinor: "maxDiscountMinor", minOrderMinor: "minOrderMinor",
    usageLimit: "usageLimit", usageLimitPerCustomer: "usageLimitPerCustomer",
    startAt: "validFrom", endAt: "validUntil", isActive: "isActive", isDraft: "isDraft",
    appliesTo: "appliesTo", allowSaleItems: "allowSaleItems", allowOtherDiscounts: "allowOtherDiscounts",
  };
  for (const [k, col] of Object.entries(map)) if (v[k] !== undefined) data[col] = v[k];
  if (data.name === "") data.name = null;
  if (data.description === "") data.description = null;
  // A cap only means something for a percentage.
  if (data.discountType === "flat") data.maxDiscountMinor = null;
  return data;
};

export async function listCoupons({ status, search, limit = 200 } = {}) {
  const q = String(search ?? "").trim();
  const rows = await prisma.coupon.findMany({
    where: {
      deletedAt: null,
      ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 200, 1), 500),
    include,
  });
  const now = new Date();
  const shaped = rows.map((c) => shapeCoupon(c, now));
  const counts = { total: shaped.length, draft: 0, scheduled: 0, active: 0, paused: 0, expired: 0, usage_limit_reached: 0 };
  for (const c of shaped) counts[c.status] = (counts[c.status] ?? 0) + 1;
  // Status is derived, so the filter is applied after shaping (tables are small).
  const coupons = status && status !== "all" ? shaped.filter((c) => c.status === status) : shaped;
  return { coupons, counts };
}

export async function getCoupon(id) {
  const c = await prisma.coupon.findFirst({ where: { id, deletedAt: null }, include });
  if (!c) throw notFound("Coupon not found");
  return shapeCoupon(c);
}

export async function createCoupon(adminId, body) {
  const v = createSchema.parse(body);
  assertCoherent(v);
  const taken = await prisma.coupon.findUnique({ where: { code: v.code } });
  if (taken) {
    throw conflict(
      taken.deletedAt ? `Code ${v.code} belongs to an archived coupon — choose another code` : `Coupon code ${v.code} already exists`,
      "COUPON_CODE_EXISTS",
    );
  }
  const created = await prisma.$transaction(async (tx) => {
    await assertTargetsExist(tx, v);
    return tx.coupon.create({
      data: {
        ...toRow(v),
        products: v.appliesTo === "products" ? { create: [...new Set(v.productIds)].map((productId) => ({ productId })) } : undefined,
        categories: v.appliesTo === "categories" ? { create: [...new Set(v.categoryIds)].map((categoryId) => ({ categoryId })) } : undefined,
      },
      include,
    });
  });
  await recordEvent({ eventType: "coupon.created", actorId: adminId, entityType: "Coupon", entityId: created.id, metadata: { code: created.code } });
  return shapeCoupon(created);
}

export async function updateCoupon(adminId, id, body) {
  const v = updateSchema.parse(body);
  const existing = await prisma.coupon.findFirst({
    where: { id, deletedAt: null },
    include: { products: true, categories: true },
  });
  if (!existing) throw notFound("Coupon not found");

  // Validate the record as it WILL be, so a partial PATCH cannot leave it incoherent.
  const merged = {
    discountType: v.discountType ?? existing.discountType,
    discountValue: v.discountValue ?? existing.discountValue,
    startAt: v.startAt ?? existing.validFrom,
    endAt: v.endAt ?? existing.validUntil,
    appliesTo: v.appliesTo ?? existing.appliesTo,
    productIds: v.productIds ?? existing.products.map((r) => r.productId),
    categoryIds: v.categoryIds ?? existing.categories.map((r) => r.categoryId),
    usageLimit: v.usageLimit !== undefined ? v.usageLimit : existing.usageLimit,
    usageLimitPerCustomer: v.usageLimitPerCustomer !== undefined ? v.usageLimitPerCustomer : existing.usageLimitPerCustomer,
  };
  assertCoherent(merged);

  if (v.code && v.code !== existing.code) {
    const taken = await prisma.coupon.findUnique({ where: { code: v.code } });
    if (taken) throw conflict(`Coupon code ${v.code} already exists`, "COUPON_CODE_EXISTS");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await assertTargetsExist(tx, v);
    const scope = merged.appliesTo;
    // Targets follow the scope: leaving "products" clears the product list, etc.
    if (v.productIds !== undefined || v.appliesTo !== undefined) {
      await tx.couponProduct.deleteMany({ where: { couponId: id } });
      if (scope === "products") {
        await tx.couponProduct.createMany({ data: [...new Set(merged.productIds)].map((productId) => ({ couponId: id, productId })) });
      }
    }
    if (v.categoryIds !== undefined || v.appliesTo !== undefined) {
      await tx.couponCategory.deleteMany({ where: { couponId: id } });
      if (scope === "categories") {
        await tx.couponCategory.createMany({ data: [...new Set(merged.categoryIds)].map((categoryId) => ({ couponId: id, categoryId })) });
      }
    }
    return tx.coupon.update({ where: { id }, data: toRow(v), include });
  });
  await recordEvent({
    eventType: "coupon.updated", actorId: adminId, entityType: "Coupon", entityId: id,
    metadata: { code: updated.code, fields: Object.keys(v) },
  });
  return shapeCoupon(updated);
}

/** Archive (soft delete). The code stays reserved so old orders keep meaning. */
export async function archiveCoupon(adminId, id) {
  const existing = await prisma.coupon.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Coupon not found");
  await prisma.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await recordEvent({ eventType: "coupon.archived", actorId: adminId, entityType: "Coupon", entityId: id, metadata: { code: existing.code } });
  return { id, archived: true };
}
