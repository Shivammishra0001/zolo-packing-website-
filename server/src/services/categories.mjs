// Product Catalog → Categories. One self-referential table: a category has
// parentId = null, a subcategory points at its parent. Admin owns the tree
// (create / edit / activate / reorder / move / archive); the storefront reads
// the PUBLIC tree, which only ever contains active, non-archived rows, in
// sortOrder.
//
// Rules that keep the catalog safe:
//  - slugs are URL-safe, generated from the name, editable, globally unique
//  - a category/subcategory that still has products cannot be archived — the
//    admin reassigns them first (products are never touched here)
//  - archiving is soft (deletedAt); rows keep their id so order history and
//    the importer's restore-on-import keep working
import { z, ZodError } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { env } from "../lib/env.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { slugify } from "./catalog-normalize.mjs";
import { recordEvent } from "./events.mjs";

const issue = (path, message) => new ZodError([{ code: "custom", path: [path], message }]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const plain = (max) => z.string().trim().max(max).transform((v) => v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
const uploadedImage = z.string().trim().max(600).nullable().optional().refine(
  (v) => v == null || v === "" || v.startsWith(`${env.uploadsBaseUrl}/`),
  "Upload the image through the category form",
).transform((v) => (v ? v : null));

const fields = {
  name: plain(80).pipe(z.string().min(2, "Name needs at least 2 characters")),
  slug: z.string().trim().toLowerCase().max(80).regex(SLUG_RE, "Use lowercase letters, numbers and hyphens only").optional(),
  description: plain(500).nullable().optional(),
  image: uploadedImage,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().min(1).nullable().optional(),
};
const createSchema = z.object(fields).strict();
const updateSchema = z.object(fields).partial().strict();

// ---- shaping ----------------------------------------------------------------

const productWhere = { deletedAt: null };
const activeProductWhere = { deletedAt: null, status: "active" };
const counted = (scope) => ({
  _count: {
    select: {
      products: { where: scope === "admin" ? productWhere : activeProductWhere },
      subProducts: { where: scope === "admin" ? productWhere : activeProductWhere },
    },
  },
});

/** A category or subcategory as the admin sees it. */
function shapeAdmin(c, parent = null) {
  const own = c.parentId ? c._count?.subProducts ?? 0 : c._count?.products ?? 0;
  return {
    id: c.id, name: c.name, slug: c.slug, description: c.description, image: c.image, sortOrder: c.sortOrder,
    isActive: c.isActive, archived: Boolean(c.deletedAt), parentId: c.parentId,
    parentName: parent?.name ?? null, parentSlug: parent?.slug ?? null,
    productCount: own, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

const byOrder = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * The tree. scope "public": active + non-archived only, storefront counts
 * (active products). scope "admin": every non-archived row, all counts.
 */
export async function tree({ scope = "public", includeEmpty = true } = {}) {
  const rows = await prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: counted(scope),
  });
  const byId = new Map(rows.map((c) => [c.id, c]));

  // Representative product image per category, used when the admin has not
  // uploaded one: the first active product image in the category or its subs.
  const withImages = await prisma.product.findMany({
    where: { ...activeProductWhere, images: { isEmpty: false } },
    select: { categoryId: true, subcategoryId: true, images: true },
    orderBy: { createdAt: "asc" },
  });
  const productImage = new Map();
  for (const p of withImages) {
    const url = p.images[0];
    if (!url) continue;
    for (const key of [p.categoryId, p.subcategoryId]) if (key && !productImage.has(key)) productImage.set(key, url);
  }
  const visible = (c) => scope === "admin" || c.isActive;

  const tree = rows
    .filter((c) => !c.parentId && visible(c))
    .sort(byOrder)
    .map((parent) => {
      const subs = rows.filter((c) => c.parentId === parent.id && visible(c)).sort(byOrder);
      const fallbackImage = productImage.get(parent.id) ?? subs.map((s) => productImage.get(s.id)).find(Boolean) ?? null;
      return {
        ...shapeAdmin(parent),
        // `image` = what to show; `imageSource` tells the admin where it came from.
        image: parent.image ?? fallbackImage,
        imageSource: parent.image ? "uploaded" : fallbackImage ? "product" : null,
        subcategoryCount: subs.length,
        subcategories: subs.map((s) => ({
          ...shapeAdmin(s, parent),
          image: s.image ?? productImage.get(s.id) ?? null,
          imageSource: s.image ? "uploaded" : productImage.get(s.id) ? "product" : null,
        })),
      };
    })
    .filter((c) => includeEmpty || c.productCount > 0 || c.subcategories.length > 0);

  // Flat list kept for existing callers (importer, admin pickers).
  const categories = rows.filter(visible).map((c) => shapeAdmin(c, c.parentId ? byId.get(c.parentId) : null));
  return { categories, tree };
}

export async function get(id) {
  const c = await prisma.category.findFirst({ where: { id, deletedAt: null }, include: counted("admin") });
  if (!c) throw notFound("Category not found");
  const parent = c.parentId ? await prisma.category.findUnique({ where: { id: c.parentId } }) : null;
  const children = c.parentId ? [] : await prisma.category.findMany({ where: { parentId: c.id, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: counted("admin") });
  return { ...shapeAdmin(c, parent), subcategories: children.map((s) => shapeAdmin(s, c)) };
}

// ---- slugs ---------------------------------------------------------------------

/** URL-safe slug from a name; subcategories are prefixed with the parent slug. */
export function slugFor(name, parent = null) {
  const base = slugify(name, parent ? "sub" : "category");
  return (parent ? `${parent.slug}-${base}` : base).slice(0, 80).replace(/-+$/, "");
}

/** Make `slug` unique by appending -2, -3 … (archived rows keep theirs). */
async function uniqueSlug(slug, exceptId = null, tx = prisma) {
  let candidate = slug;
  for (let n = 2; n < 1000; n++) {
    const clash = await tx.category.findFirst({ where: { slug: candidate, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (!clash) return candidate;
    candidate = `${slug}-${n}`.slice(0, 80);
  }
  throw conflict("Could not find a free slug", "SLUG_TAKEN");
}

async function assertSlugFree(slug, exceptId = null, tx = prisma) {
  const clash = await tx.category.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw issue("slug", clash.deletedAt ? `"${slug}" belongs to an archived category — choose another slug` : `"${slug}" is already used by ${clash.name}`);
}

async function assertNameFree(name, parentId, exceptId = null, tx = prisma) {
  const clash = await tx.category.findFirst({
    where: { deletedAt: null, parentId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw issue("name", parentId ? `This category already has a subcategory called "${clash.name}"` : `A category called "${clash.name}" already exists`);
}

async function parentFor(parentId, tx = prisma) {
  if (!parentId) return null;
  const parent = await tx.category.findFirst({ where: { id: parentId, deletedAt: null } });
  if (!parent) throw issue("parentId", "Choose a valid parent category");
  if (parent.parentId) throw issue("parentId", "Subcategories cannot be nested under another subcategory");
  return parent;
}

async function nextSortOrder(parentId, tx = prisma) {
  const last = await tx.category.findFirst({ where: { parentId, deletedAt: null }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return (last?.sortOrder ?? 0) + 1;
}

// ---- writes ---------------------------------------------------------------------

/**
 * Create a category (parentId null) or a subcategory. Used by the admin form
 * AND by the importer's "create if missing" path (name only): with no slug the
 * slug is generated; an archived row with the same slug is restored instead
 * of duplicated, which keeps re-imports idempotent.
 */
export async function create(adminId, body) {
  const v = createSchema.parse(body);
  const parent = await parentFor(v.parentId ?? null);
  const parentId = parent?.id ?? null;

  const wanted = v.slug ?? slugFor(v.name, parent);
  const archived = await prisma.category.findFirst({ where: { slug: wanted, deletedAt: { not: null } } });
  if (archived && !v.slug) {
    // Same identity as before → restore (keeps id, relations, order history).
    const restored = await prisma.category.update({
      where: { id: archived.id },
      data: { deletedAt: null, isActive: v.isActive ?? true, name: v.name, parentId, description: v.description ?? archived.description, image: v.image ?? archived.image },
      include: counted("admin"),
    });
    await recordEvent({ eventType: "category.restored", actorId: adminId, entityType: "Category", entityId: restored.id, metadata: { name: restored.name, slug: restored.slug } });
    return shapeAdmin(restored, parent);
  }

  await assertNameFree(v.name, parentId);
  const slug = v.slug ? (await assertSlugFree(v.slug), v.slug) : await uniqueSlug(wanted);
  const created = await prisma.category.create({
    data: {
      name: v.name, slug, description: v.description ?? null, image: v.image ?? null, parentId,
      sortOrder: v.sortOrder ?? (await nextSortOrder(parentId)), isActive: v.isActive ?? true,
    },
    include: counted("admin"),
  });
  await recordEvent({ eventType: parent ? "subcategory.created" : "category.created", actorId: adminId, entityType: "Category", entityId: created.id, metadata: { name: created.name, slug, parentId } });
  return shapeAdmin(created, parent);
}

export async function update(adminId, id, body) {
  const v = updateSchema.parse(body);
  const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Category not found");

  // Moving: a subcategory may move to another category; a category with
  // subcategories cannot become a subcategory (that would nest three deep).
  let parentId = existing.parentId;
  if (v.parentId !== undefined && v.parentId !== existing.parentId) {
    if (v.parentId === id) throw issue("parentId", "A category cannot be its own parent");
    if (v.parentId && !existing.parentId) {
      const children = await prisma.category.count({ where: { parentId: id, deletedAt: null } });
      if (children) throw issue("parentId", "Move or archive its subcategories before turning this category into a subcategory");
    }
    parentId = (await parentFor(v.parentId))?.id ?? null;
  }
  const parent = parentId ? await prisma.category.findUnique({ where: { id: parentId } }) : null;
  const name = v.name ?? existing.name;
  if (v.name !== undefined || parentId !== existing.parentId) await assertNameFree(name, parentId, id);
  if (v.slug !== undefined && v.slug !== existing.slug) await assertSlugFree(v.slug, id);

  const data = {};
  if (v.name !== undefined) data.name = v.name;
  if (v.slug !== undefined) data.slug = v.slug;
  if (v.description !== undefined) data.description = v.description;
  if (v.image !== undefined) data.image = v.image;
  if (v.sortOrder !== undefined) data.sortOrder = v.sortOrder;
  if (v.isActive !== undefined) data.isActive = v.isActive;
  if (parentId !== existing.parentId) { data.parentId = parentId; data.sortOrder = v.sortOrder ?? (await nextSortOrder(parentId)); }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.category.update({ where: { id }, data, include: counted("admin") });
    // Products carry the denormalized name; keep it in step with a rename so
    // legacy string lookups (matching, search) do not drift from the tree.
    if (v.name !== undefined && v.name !== existing.name) {
      if (existing.parentId) await tx.product.updateMany({ where: { subcategoryId: id }, data: { subcategory: v.name } });
      else await tx.product.updateMany({ where: { categoryId: id }, data: { category: v.name } });
    }
    if (parentId !== existing.parentId && existing.parentId) {
      // A moved subcategory takes its products to the new parent.
      const np = parent;
      await tx.product.updateMany({ where: { subcategoryId: id }, data: { categoryId: np?.id ?? null, category: np?.name ?? existing.name } });
    }
    return row;
  });

  const changed = Object.keys(v);
  if (changed.includes("isActive") && v.isActive !== existing.isActive) {
    await recordEvent({ eventType: v.isActive ? "category.activated" : "category.deactivated", actorId: adminId, entityType: "Category", entityId: id, metadata: { name: updated.name, slug: updated.slug } });
  }
  if (changed.some((k) => k !== "isActive")) {
    await recordEvent({ eventType: parentId !== existing.parentId ? "subcategory.moved" : "category.updated", actorId: adminId, entityType: "Category", entityId: id, metadata: { name: updated.name, slug: updated.slug, fields: changed, from: existing.parentId, to: parentId } });
  }
  return shapeAdmin(updated, parent);
}

export const setStatus = (adminId, id, isActive) => update(adminId, id, { isActive: Boolean(isActive) });

/**
 * Reorder siblings: `ids` is the full desired order of one parent's children
 * (parentId null = top-level categories). Persisted as 1..n in sortOrder.
 */
export async function reorder(adminId, { parentId = null, ids }) {
  if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string")) throw issue("ids", "Send the ordered list of ids");
  const siblings = await prisma.category.findMany({ where: { parentId: parentId || null, deletedAt: null }, select: { id: true } });
  const known = new Set(siblings.map((s) => s.id));
  if (ids.some((x) => !known.has(x))) throw issue("ids", "Every id must belong to the same parent");
  const rest = siblings.map((s) => s.id).filter((x) => !ids.includes(x)); // any omitted ones keep trailing
  const ordered = [...new Set([...ids, ...rest])];
  await prisma.$transaction(ordered.map((id, i) => prisma.category.update({ where: { id }, data: { sortOrder: i + 1 } })));
  await recordEvent({ eventType: "category.reordered", actorId: adminId, entityType: "Category", entityId: parentId ?? "root", metadata: { parentId, order: ordered } });
  return { parentId: parentId || null, order: ordered };
}

/** Move one row to an absolute position among its siblings (1-based). */
export async function setPosition(adminId, id, position) {
  const pos = Number(position);
  if (!Number.isInteger(pos) || pos < 1) throw issue("position", "Position must be a whole number from 1");
  const row = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw notFound("Category not found");
  const siblings = (await prisma.category.findMany({ where: { parentId: row.parentId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } })).map((s) => s.id).filter((x) => x !== id);
  siblings.splice(Math.min(pos, siblings.length + 1) - 1, 0, id);
  return reorder(adminId, { parentId: row.parentId, ids: siblings });
}

/**
 * Archive. REFUSED while products still reference the row (the admin reassigns
 * them first). A category is also refused while it has non-archived
 * subcategories. Never deletes a product, never hard-deletes the row.
 */
export async function archive(adminId, id) {
  const row = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw notFound("Category not found");
  const products = await prisma.product.count({ where: { deletedAt: null, OR: [{ categoryId: id }, { subcategoryId: id }] } });
  if (products) {
    const err = conflict(
      row.parentId
        ? `This subcategory contains ${products} product${products === 1 ? "" : "s"}. Please reassign the products before deleting this subcategory.`
        : `This category contains ${products} product${products === 1 ? "" : "s"}. Please reassign the products before deleting this category.`,
      "CATEGORY_HAS_PRODUCTS",
    );
    err.productCount = products;
    throw err;
  }
  const children = await prisma.category.count({ where: { parentId: id, deletedAt: null } });
  if (children) throw conflict(`This category has ${children} subcategor${children === 1 ? "y" : "ies"}. Archive or move them first.`, "CATEGORY_HAS_SUBCATEGORIES");
  await prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await recordEvent({ eventType: row.parentId ? "subcategory.archived" : "category.archived", actorId: adminId, entityType: "Category", entityId: id, metadata: { name: row.name, slug: row.slug } });
  return { id, archived: true, productsAffected: 0 };
}

/** Is this row usable for a NEW product assignment? (active + not archived) */
export const assignable = (row) => Boolean(row && !row.deletedAt && row.isActive);

export { badRequest };
