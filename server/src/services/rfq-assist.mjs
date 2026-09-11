// ============================================================
// Rule-based packaging assistant for the "Create Bulk Quote" builder.
//
// NO external LLM is used (the project has none — see ai-analyzer.mjs). This is
// a deterministic keyword matcher: it reads the buyer's free-text brief, maps it
// to a packaging category / material / shape, extracts a quantity, and surfaces
// real catalogue products that match. Every value it returns is a SUGGESTION the
// buyer edits before anything is submitted — it never creates or sends an RFQ.
// ============================================================
import { prisma } from "../lib/prisma.mjs";

// Ordered rules: the first whose keyword appears in the brief wins for the
// "type" fields. Categories mirror the storefront's real category names so the
// suggested category can feed seller matching if the buyer keeps it.
const RULES = [
  { keys: ["pizza box", "pizza"], category: "Food Packaging", material: "Corrugated", productType: "box", dimensions: "12 × 12 × 2 inch", note: "Corrugated pizza boxes are usually printed 1–2 colour on kraft." },
  { keys: ["burger", "takeaway", "meal box", "food box", "lunch box"], category: "Food Packaging", material: "Kraft Paper", productType: "box", dimensions: "" },
  { keys: ["glass bottle", "glass jar"], category: "Containers", material: "Glass", productType: "bottle", dimensions: "" },
  { keys: ["pet bottle", "plastic bottle"], category: "Containers", material: "PET", productType: "bottle", dimensions: "" },
  { keys: ["bottle"], category: "Containers", material: "PET", productType: "bottle", dimensions: "" },
  { keys: ["jar"], category: "Containers", material: "Glass", productType: "bottle", dimensions: "" },
  { keys: ["mailer", "shipping box", "corrugated", "carton", "shipper"], category: "Boxes", material: "Corrugated", productType: "box", dimensions: "" },
  { keys: ["rigid box", "cosmetic", "skincare", "luxury", "gift box", "premium box"], category: "Boxes", material: "Paperboard", productType: "box", dimensions: "", note: "Rigid boxes suit premium/cosmetic products — consider foil or spot-UV finishes." },
  { keys: ["pouch", "sachet", "stand up", "ziplock", "mylar"], category: "Flexible Packaging", material: "Plastic", productType: "flat", dimensions: "" },
  { keys: ["paper bag", "shopping bag", "carry bag", "bag"], category: "Bags", material: "Kraft Paper", productType: "flat", dimensions: "" },
  { keys: ["tape", "bopp"], category: "Tapes", material: "Plastic", productType: "circular", dimensions: "" },
  { keys: ["tube"], category: "Tubes", material: "Aluminium", productType: "circular", dimensions: "" },
  { keys: ["sticker", "label"], category: "Packaging Accessories", material: "Paper", productType: "flat", dimensions: "" },
  { keys: ["cup", "coffee cup", "paper cup"], category: "Drinkware", material: "Paperboard", productType: "circular", dimensions: "" },
  { keys: ["can", "tin"], category: "Containers", material: "Tin", productType: "circular", dimensions: "" },
];

const UNITS = ["bottles", "jars", "boxes", "bags", "rolls", "sets", "sheets", "pcs", "pieces", "units", "kg", "meters"];

/** Pull a plausible quantity out of the brief (handles "5,000", "5k", "500"). */
function extractQuantity(text) {
  // "5k" / "5 k"
  const kMatch = text.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  // "5,000" / "500"
  const nMatch = text.match(/(\d[\d,]{1,})/);
  if (nMatch) {
    const n = parseInt(nMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractUnit(text) {
  for (const u of UNITS) if (text.includes(u)) return u === "pieces" || u === "units" ? "pcs" : u;
  return null;
}

/**
 * Analyse a free-text brief and return editable suggestions plus matching
 * catalogue products. Deterministic; safe to call for any signed-in buyer.
 */
export async function assist(rawPrompt) {
  const prompt = String(rawPrompt ?? "").trim();
  const text = prompt.toLowerCase();
  if (!text) {
    return { productType: null, category: null, material: null, color: null, dimensions: null, quantity: null, unit: null, printing: null, note: "Describe what you need — e.g. \"500 glass bottles with a printed label\".", products: [] };
  }

  const rule = RULES.find((r) => r.keys.some((k) => text.includes(k))) ?? null;
  const quantity = extractQuantity(text);
  const unit = extractUnit(text) ?? (rule?.productType === "bottle" ? "bottles" : "pcs");

  // Colour / printing hints (light touch — the buyer refines these).
  const colorHints = ["brown", "white", "black", "kraft", "transparent", "clear", "gold", "silver"].filter((c) => text.includes(c));
  const printing = /print|logo|branding|cmyk|colour print|color print|4 colour|4 color/.test(text) ? "Yes — printing required" : null;

  // Find real, buyer-visible products that match the brief (by category or by
  // any keyword token in name/description). Snapshot-safe: read-only.
  const tokens = [...new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length >= 4))].slice(0, 8);
  let products = [];
  try {
    const rows = await prisma.product.findMany({
      where: {
        deletedAt: null,
        status: "active",
        OR: [
          ...(rule ? [{ category: { equals: rule.category, mode: "insensitive" } }] : []),
          ...tokens.map((t) => ({ name: { contains: t, mode: "insensitive" } })),
          ...tokens.map((t) => ({ description: { contains: t, mode: "insensitive" } })),
        ],
      },
      select: { id: true, name: true, sku: true, slug: true, category: true },
      take: 6,
    });
    products = rows;
  } catch {
    products = [];
  }

  const note = rule?.note ?? (rule ? `Suggested ${rule.category} in ${rule.material}. Adjust anything below before adding it to your quote.` : "Couldn't match a specific packaging type — pick a category and material below, or add a custom product.");

  return {
    productType: rule?.productType ?? null,
    category: rule?.category ?? null,
    material: rule?.material ?? null,
    color: colorHints.length ? colorHints.map((c) => c[0].toUpperCase() + c.slice(1)).join(", ") : null,
    dimensions: rule?.dimensions || null,
    quantity,
    unit,
    printing,
    note,
    products,
  };
}
