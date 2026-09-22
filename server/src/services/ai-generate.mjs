// AI product generation orchestration — scan repo images, analyze (rule-based),
// cache by content hash (cost control), and create DRAFT products for admin
// review. NEVER auto-publishes: generated products are status "draft" and the
// analysis is ANALYZED / REVIEW_REQUIRED until an admin approves.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.mjs";
import { put, getUrl } from "../lib/storage.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";
import { analyzeByFilename, isNonProductImage, skuCodeForCategory } from "./ai-analyzer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The existing catalog image directory (discovered from the repo). Read-only.
const IMAGES_DIR = join(__dirname, "..", "..", "..", "images");
const IMG_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;
const MIME_BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Build the image index from the existing images directory. Originals are only
 * READ — never renamed, moved, compressed or deleted. UI assets (category_*,
 * logo, hero…) are excluded. Returns [{ filename, sizeBytes }].
 */
export function scanImages() {
  if (!existsSync(IMAGES_DIR)) return [];
  return readdirSync(IMAGES_DIR)
    .filter((f) => IMG_EXT_RE.test(f) && !isNonProductImage(f))
    .map((filename) => ({ filename }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function readImage(filename) {
  const path = join(IMAGES_DIR, filename);
  // Defense-in-depth against path traversal — the resolved path must stay in dir.
  if (!path.startsWith(IMAGES_DIR) || filename.includes("..") || filename.includes("/")) {
    throw badRequest("Invalid image name", "BAD_IMAGE");
  }
  if (!existsSync(path)) throw notFound("Image not found");
  return readFileSync(path);
}

async function knownCategoryNames() {
  const rows = await prisma.product.findMany({ where: { deletedAt: null }, select: { category: true }, distinct: ["category"] });
  return rows.map((r) => r.category).filter(Boolean);
}

// Deterministic, unique SKU: ZOLO-<CATCODE>-NNN. Scans existing products +
// analyses for the highest sequence in that category and increments.
async function generateSku(category, existingByBase) {
  const code = skuCodeForCategory(category);
  const prefix = `ZOLO-${code}-`;
  let max = 0;
  for (const sku of existingByBase) {
    if (sku?.toUpperCase().startsWith(prefix)) {
      const n = Number(sku.slice(prefix.length));
      if (!Number.isNaN(n)) max = Math.max(max, n);
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "product";

async function uniqueSlug(base) {
  let slug = slugify(base);
  let n = 1;
  while (await prisma.product.findUnique({ where: { slug } })) slug = `${slugify(base)}-${++n}`;
  return slug;
}

/**
 * Analyze a batch of image filenames. For each: reuse the cached analysis when
 * the image content is unchanged (hash match) unless `force` re-analysis is
 * requested. Returns the analysis rows (no product created yet).
 */
export async function analyzeImages({ filenames, force = false, actorId = null }) {
  if (!Array.isArray(filenames) || filenames.length === 0) throw badRequest("Select at least one image", "NO_IMAGES");
  const known = await knownCategoryNames();
  const results = [];

  for (const filename of filenames.slice(0, 200)) {
    const buf = readImage(filename);
    const imageHash = sha256(buf);

    // Cost control: reuse an existing analysis for identical image bytes.
    const cached = await prisma.productAiAnalysis.findUnique({ where: { imageHash } });
    if (cached && !force) { results.push({ ...cached, cached: true }); continue; }

    const a = analyzeByFilename(filename, { knownCategories: known });
    const data = {
      imageHash,
      sourceName: filename,
      status: a.status,
      name: a.name,
      suggestedSku: a.suggestedSku,
      category: a.category,
      isNewCategory: a.isNewCategory,
      productType: a.productType,
      material: a.material,
      color: a.color,
      shape: a.shape,
      usage: a.usage,
      description: a.description,
      shortDescription: a.shortDescription,
      tags: a.tags,
      seoTitle: a.seoTitle,
      seoDescription: a.seoDescription,
      confidence: a.confidence,
      reviewReason: a.reviewReason,
    };
    const saved = cached
      ? await prisma.productAiAnalysis.update({ where: { imageHash }, data })
      : await prisma.productAiAnalysis.create({ data });
    results.push({ ...saved, cached: false });
  }

  if (actorId) await recordEvent({ eventType: "ai.images_analyzed", actorId, metadata: { count: results.length } });
  return listAnalyses();
}

// Upload a copy of the source image to the storage layer (original untouched)
// and return the permanent served URL.
function uploadCopy(filename) {
  const buf = readImage(filename);
  const ext = (IMG_EXT_RE.exec(filename)?.[1] ?? "jpg").toLowerCase();
  const key = put({ name: filename, mime: MIME_BY_EXT[ext] ?? "image/jpeg", buffer: buf });
  return getUrl(key);
}

/**
 * Approve an analysis → create (or update) a DRAFT product. Never publishes:
 * the product is created with status "draft" for the admin to activate later.
 * Duplicate handling by SKU: update | skip | create-new.
 */
export async function approveAnalysis(analysisId, { overrides = {}, dupeMode = "update", actorId = null }) {
  const analysis = await prisma.productAiAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw notFound("Analysis not found");
  if (analysis.status === "REVIEW_REQUIRED" && !overrides.name) {
    throw badRequest("This item needs a product name before it can be approved", "NAME_REQUIRED");
  }

  // Merge admin edits over the AI-derived data.
  const name = (overrides.name ?? analysis.name ?? "").trim();
  const category = (overrides.category ?? analysis.category ?? "Uncategorised").trim();
  if (!name) throw badRequest("Product name is required", "NAME_REQUIRED");

  // SKU: use the admin's, else the filename-embedded one, else generate.
  const existingSkus = (await prisma.product.findMany({ select: { sku: true } })).map((p) => p.sku);
  const analysisSkus = (await prisma.productAiAnalysis.findMany({ where: { suggestedSku: { not: null } }, select: { suggestedSku: true } })).map((a) => a.suggestedSku);
  let sku = (overrides.sku ?? analysis.suggestedSku ?? "").trim();
  if (!sku) sku = await generateSku(category, [...existingSkus, ...analysisSkus]);

  // Duplicate detection by SKU.
  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing && dupeMode === "skip") {
    await prisma.productAiAnalysis.update({ where: { id: analysisId }, data: { status: "REJECTED", reviewReason: "Skipped — SKU already exists" } });
    return { action: "skipped", sku };
  }
  if (existing && dupeMode === "create-new") {
    sku = await generateSku(category, [...existingSkus, ...analysisSkus, sku]);
  }

  const imageUrl = analysis.imageUrl ?? uploadCopy(analysis.sourceName);
  const description = (overrides.description ?? analysis.description ?? undefined) || undefined;
  const priceMinor = Number.isFinite(overrides.basePriceMinor) ? overrides.basePriceMinor : 0; // 0 = quotation-based; never invent price

  const productData = {
    sku,
    slug: await uniqueSlug(name),
    name,
    category,
    subcategory: (overrides.subcategory ?? "General").trim() || "General",
    // ALWAYS draft — AI-generated products are never auto-published.
    status: "draft",
    description,
    color: overrides.color ?? analysis.color ?? undefined,
    material: overrides.material ?? analysis.material ?? undefined,
    basePriceMinor: priceMinor,
    stock: 0, // no invented inventory
    imageEmoji: imageUrl,
    images: [imageUrl],
    variants: [],
  };

  let product;
  if (existing && dupeMode === "update") {
    product = await prisma.product.update({ where: { sku }, data: { ...productData, slug: existing.slug } });
  } else {
    product = await prisma.product.create({ data: { id: `PRD-${sku.replace(/[^A-Z0-9]/gi, "").slice(-8)}-${Date.now().toString(36).slice(-3)}`.toUpperCase(), ...productData } });
  }

  await prisma.productAiAnalysis.update({
    where: { id: analysisId },
    data: { status: "APPROVED", productId: product.id, imageUrl, suggestedSku: sku, name, category },
  });
  if (actorId) await recordEvent({ eventType: "ai.product_created", actorId, entityType: "Product", entityId: product.id, metadata: { sku, fromImage: analysis.sourceName } });

  return { action: existing && dupeMode === "update" ? "updated" : "created", product, sku };
}

export async function rejectAnalysis(analysisId, { actorId = null } = {}) {
  const analysis = await prisma.productAiAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw notFound("Analysis not found");
  await prisma.productAiAnalysis.update({ where: { id: analysisId }, data: { status: "REJECTED" } });
  if (actorId) await recordEvent({ eventType: "ai.analysis_rejected", actorId, entityId: analysisId });
  return { rejected: true };
}

export async function listAnalyses() {
  const rows = await prisma.productAiAnalysis.findMany({ orderBy: { createdAt: "desc" } });
  const total = rows.length;
  return {
    total,
    ready: rows.filter((r) => r.status === "ANALYZED").length,
    reviewRequired: rows.filter((r) => r.status === "REVIEW_REQUIRED").length,
    approved: rows.filter((r) => r.status === "APPROVED").length,
    rejected: rows.filter((r) => r.status === "REJECTED").length,
    analyses: rows,
  };
}
