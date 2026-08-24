// ============================================================
// Repair existing catalog rows in place.
//
// Products imported before the canonical pipeline existed are missing
// subcategory records, parsed dimensions, sizeLabel, productType and
// thickness. This backfills them FROM DATA ALREADY IN THE DATABASE — it never
// invents values, never touches price or stock, and never deletes anything.
//
//   node --env-file=.env scripts/repair-catalog.mjs [--dry-run]
// ============================================================
import { prisma } from "../src/lib/prisma.mjs";
import { resolveCategory, resolveSubcategory } from "../src/services/catalog.mjs";
import { parseSize, text } from "../src/services/catalog-normalize.mjs";

const dryRun = process.argv.includes("--dry-run");

const stats = {
  scanned: 0, updated: 0, unchanged: 0,
  categoriesLinked: 0, subcategoriesCreated: 0, subcategoriesLinked: 0,
  dimensionsParsed: 0, sizeLabelsKept: 0, failed: 0,
};
const errors = [];

/**
 * Recover the original Size text.
 *
 * Pre-repair rows kept dimensions in length/width/height but discarded the raw
 * string; rows whose size was a capacity kept nothing. Where dimensions exist
 * we can faithfully reconstruct the label; otherwise there is nothing in the
 * database to recover and the field stays null (a re-import restores it).
 */
function sizeLabelFrom(product) {
  if (product.sizeLabel) return product.sizeLabel;
  if (product.length != null && product.width != null && product.height != null) {
    return `${product.length} x ${product.width} x ${product.height} ${product.dimUnit ?? "in"}`;
  }
  return null;
}

/** Pull "Material: X · Type: Y · Thickness: Z" back out of the description tail. */
function extrasFromDescription(description) {
  const out = {};
  if (!description) return out;
  const tail = description.split(" — ").slice(1).join(" — ");
  for (const part of tail.split("·")) {
    const [k, ...rest] = part.split(":");
    const value = text(rest.join(":"));
    if (!value) continue;
    const key = k.trim().toLowerCase();
    if (key === "type") out.productType = value;
    if (key === "thickness") out.thickness = value;
    if (key === "material") out.material = value;
  }
  return out;
}

const categoryCache = new Map();
const subcategoryCache = new Map();

const products = await prisma.product.findMany({ where: { deletedAt: null }, orderBy: { sku: "asc" } });
console.log(`Scanning ${products.length} products${dryRun ? " (dry run — no writes)" : ""}…\n`);

for (const product of products) {
  stats.scanned++;
  try {
    const data = {};

    // 1. Category link — the denormalized string is the source of truth here.
    if (product.category) {
      const category = await resolveCategory(product.category, categoryCache);
      if (category && product.categoryId !== category.id) {
        data.categoryId = category.id;
        data.category = category.name;
        stats.categoriesLinked++;
      }

      // 2. Subcategory becomes a real record nested under its parent.
      if (category && product.subcategory && product.subcategory.toLowerCase() !== "general") {
        const before = subcategoryCache.size;
        const sub = await resolveSubcategory(product.subcategory, category, subcategoryCache);
        if (sub) {
          if (subcategoryCache.size > before) stats.subcategoriesCreated++;
          if (product.subcategoryId !== sub.id) {
            data.subcategoryId = sub.id;
            data.subcategory = sub.name;
            stats.subcategoriesLinked++;
          }
        }
      }
    }

    // 3. Size → dimensions + label. Only fills gaps; never overwrites real data.
    const label = sizeLabelFrom(product);
    if (label && !product.sizeLabel) {
      data.sizeLabel = label;
      stats.sizeLabelsKept++;
    }
    if (label && product.length == null) {
      const { dimensions } = parseSize(label);
      if (dimensions) {
        Object.assign(data, {
          length: dimensions.length, width: dimensions.width,
          height: dimensions.height, dimUnit: dimensions.unit,
        });
        stats.dimensionsParsed++;
      }
    }

    // 4. Type / thickness / material recovered from the description tail.
    const extras = extrasFromDescription(product.description);
    if (extras.productType && !product.productType) data.productType = extras.productType;
    if (extras.thickness && !product.thickness) data.thickness = extras.thickness;
    if (extras.material && !product.material) data.material = extras.material;

    // NOTE: basePriceMinor and stock are deliberately untouched. 0 means
    // "on quote" / "no stock recorded" — both are real states, not gaps.

    if (Object.keys(data).length === 0) { stats.unchanged++; continue; }
    if (!dryRun) await prisma.product.update({ where: { id: product.id }, data });
    stats.updated++;
    console.log(`  ${product.sku.padEnd(16)} ${Object.keys(data).join(", ")}`);
  } catch (e) {
    stats.failed++;
    errors.push({ sku: product.sku, error: e.message });
    console.error(`  ${product.sku.padEnd(16)} FAILED: ${e.message}`);
  }
}

console.log("\n--- Repair summary ---");
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`);
if (errors.length) {
  console.log("\nErrors:");
  for (const e of errors) console.log(`  ${e.sku}: ${e.error}`);
}
await prisma.$disconnect();
process.exit(errors.length ? 1 : 0);
