// Rule-based product analyzer — derives structured catalog data from an image's
// filename + the existing category taxonomy. NO external AI provider is used
// (the project has none), so there are no API keys and no per-image cost.
//
// HONESTY RULE: this analyzer only asserts what the filename/taxonomy supports.
// Physical specs that cannot be known from a name (dimensions, GSM, weight,
// capacity, certifications) are ALWAYS "Not specified" — never invented.
//
// A descriptive filename ("kraft mailer box.png") yields a confident product.
// An opaque filename ("PRD-001.jpg") yields status REVIEW_REQUIRED so an admin
// fills it in manually — no fake data is fabricated.

// ---- Knowledge base: keyword → packaging semantics -------------------------
// Order matters: more specific phrases first. `cat` aligns with the storefront
// category taxonomy; `type` is the product type; `material` is visually-typical
// (still admin-confirmable). Confidence reflects how specific the match is.
const KB = [
  // Food packaging
  { kw: ["pizza slice"], cat: "Food Packaging", type: "Pizza Slice Box", material: "Kraft Paper", tags: ["pizza packaging", "pizza slice box", "food packaging", "takeaway packaging"] },
  { kw: ["pizza"], cat: "Food Packaging", type: "Pizza Box", material: "Corrugated Board", tags: ["pizza packaging", "pizza box", "food packaging", "takeaway packaging"] },
  { kw: ["burger"], cat: "Food Packaging", type: "Burger Box", material: "Kraft Paper", tags: ["burger packaging", "burger box", "food packaging", "takeaway packaging"] },
  { kw: ["coffee cup", "paper cup"], cat: "Containers & Bowls", type: "Coffee Cup", material: "Paper", tags: ["coffee cup", "beverage packaging", "disposable cup", "food packaging"] },
  { kw: ["food bowl", "bowl"], cat: "Containers & Bowls", type: "Food Bowl", material: "Kraft Paper", tags: ["food bowl", "food packaging", "container", "takeaway packaging"] },
  { kw: ["cake box"], cat: "Food Packaging", type: "Cake Box", material: "Cardboard", tags: ["cake box", "bakery packaging", "food packaging"] },
  { kw: ["chocolate box"], cat: "Food Packaging", type: "Chocolate Box", material: "Rigid Board", tags: ["chocolate box", "confectionery packaging", "gift packaging"] },
  { kw: ["dry fruit"], cat: "Food Packaging", type: "Dry Fruit Box", material: "Rigid Board", tags: ["dry fruit box", "food packaging", "gift box"] },
  { kw: ["sweet box"], cat: "Food Packaging", type: "Sweet Box", material: "Cardboard", tags: ["sweet box", "confectionery packaging", "food packaging"] },
  // Boxes / mailers
  { kw: ["kraft mailer", "mailer box", "mailer"], cat: "Mailer Boxes", type: "Mailer Box", material: "Kraft Board", tags: ["mailer box", "shipping box", "ecommerce packaging", "kraft packaging"] },
  { kw: ["corrugated box", "shipping box"], cat: "Corrugated Boxes", type: "Corrugated Box", material: "Corrugated Board", tags: ["corrugated box", "shipping box", "ecommerce packaging"] },
  { kw: ["gift box"], cat: "Gift Boxes", type: "Gift Box", material: "Rigid Board", tags: ["gift box", "premium packaging", "retail packaging"] },
  { kw: ["jewelry box", "jewellery box"], cat: "Gift Boxes", type: "Jewelry Box", material: "Rigid Board", tags: ["jewelry box", "premium packaging", "retail packaging"] },
  { kw: ["cosmetic box", "cosmetics box"], cat: "Retail Packaging", type: "Cosmetic Box", material: "Rigid Board", tags: ["cosmetic box", "beauty packaging", "retail packaging"] },
  { kw: ["electronic box", "electronics box"], cat: "Retail Packaging", type: "Electronics Box", material: "Corrugated Board", tags: ["electronics packaging", "retail packaging", "product box"] },
  { kw: ["bottle box", "bottle packaging"], cat: "Retail Packaging", type: "Bottle Box", material: "Kraft Board", tags: ["bottle box", "retail packaging", "product packaging"] },
  { kw: ["shoe box"], cat: "Retail Packaging", type: "Shoe Box", material: "Cardboard", tags: ["shoe box", "retail packaging", "footwear packaging"] },
  { kw: ["apparel box", "clothing box"], cat: "Retail Packaging", type: "Apparel Box", material: "Rigid Board", tags: ["apparel box", "clothing packaging", "retail packaging"] },
  // Pouches / bags / sachets
  { kw: ["compostable mailer", "poly mailer", "courier bag"], cat: "Pouches & Bags", type: "Mailer Bag", material: "Compostable Film", tags: ["mailer bag", "courier bag", "ecommerce packaging"] },
  { kw: ["stand up pouch", "standup pouch", "pouch"], cat: "Pouches & Bags", type: "Stand-Up Pouch", material: "Laminate Film", tags: ["stand up pouch", "flexible packaging", "food packaging"] },
  { kw: ["flat sachet", "sachet"], cat: "Pouches & Bags", type: "Flat Sachet", material: "Laminate Film", tags: ["sachet", "flexible packaging", "sample packaging"] },
  { kw: ["ziplock", "zip lock", "zipper bag"], cat: "Pouches & Bags", type: "Ziplock Bag", material: "Plastic Film", tags: ["ziplock bag", "resealable pouch", "flexible packaging"] },
  { kw: ["paper bag", "gift bag", "shopping bag"], cat: "Pouches & Bags", type: "Paper Bag", material: "Kraft Paper", tags: ["paper bag", "shopping bag", "retail packaging"] },
  // Cans / tins
  { kw: ["aluminum can", "aluminium can", "beverage can"], cat: "Cans & Tins", type: "Aluminium Can", material: "Aluminium", tags: ["aluminium can", "beverage packaging", "metal packaging"] },
  { kw: ["composite can"], cat: "Cans & Tins", type: "Composite Can", material: "Paperboard & Metal", tags: ["composite can", "rigid packaging", "food packaging"] },
  { kw: ["tin can", "metal tin", "tin"], cat: "Cans & Tins", type: "Tin Can", material: "Tinplate", tags: ["tin can", "metal packaging", "food packaging"] },
  // Jars / vials
  { kw: ["glass jar", "jar"], cat: "Jars", type: "Glass Jar", material: "Glass", tags: ["glass jar", "rigid packaging", "food packaging"] },
  { kw: ["glass vial", "vial"], cat: "Jars", type: "Glass Vial", material: "Glass", tags: ["glass vial", "pharma packaging", "sample packaging"] },
  { kw: ["pill bottle", "medicine bottle"], cat: "Pharma Packaging", type: "Pill Bottle", material: "Plastic", tags: ["pill bottle", "pharma packaging", "medicine packaging"] },
  { kw: ["blister"], cat: "Pharma Packaging", type: "Blister Pack", material: "Plastic & Foil", tags: ["blister pack", "pharma packaging", "tablet packaging"] },
  // Tubes
  { kw: ["aluminum tube", "aluminium tube"], cat: "Tubes", type: "Aluminium Tube", material: "Aluminium", tags: ["aluminium tube", "cosmetic packaging", "tube packaging"] },
  { kw: ["laminate tube", "cosmetic tube", "tube"], cat: "Tubes", type: "Laminate Tube", material: "Laminate", tags: ["laminate tube", "cosmetic packaging", "tube packaging"] },
  // Tapes / labels / tags
  { kw: ["kraft tape", "brown kraft tape"], cat: "Tapes", type: "Kraft Paper Tape", material: "Kraft Paper", tags: ["kraft tape", "packaging tape", "eco packaging"] },
  { kw: ["fragile tape"], cat: "Tapes", type: "Fragile Tape", material: "BOPP Film", tags: ["fragile tape", "packaging tape", "warning tape"] },
  { kw: ["packing tape", "packaging tape", "tape"], cat: "Tapes", type: "Packing Tape", material: "BOPP Film", tags: ["packing tape", "packaging tape", "shipping supplies"] },
  { kw: ["hang tag", "swing tag", "tag"], cat: "Retail Packaging", type: "Hang Tag", material: "Paper", tags: ["hang tag", "retail packaging", "branding"] },
  { kw: ["label", "sticker"], cat: "Retail Packaging", type: "Label", material: "Paper", tags: ["label", "sticker", "branding"] },
];

// Color hints that may appear in a filename (visually-inferred only).
const COLOR_HINTS = [
  { kw: ["natural kraft", "kraft"], color: "Natural Kraft Brown" },
  { kw: ["brown"], color: "Brown" },
  { kw: ["white"], color: "White" },
  { kw: ["black"], color: "Black" },
  { kw: ["clear", "transparent"], color: "Clear" },
  { kw: ["gold"], color: "Gold" },
  { kw: ["silver"], color: "Silver" },
];

// Filenames that are UI assets, not products — skipped by the scanner.
const NON_PRODUCT_PATTERNS = [/^category[_-]/i, /^hero/i, /^logo/i, /banner/i, /favicon/i, /placeholder/i];

export function isNonProductImage(filename) {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  return NON_PRODUCT_PATTERNS.some((re) => re.test(base));
}

// Normalize a filename into a searchable phrase: strip ext, lowercase, turn
// separators into spaces, collapse whitespace.
export function normalizeName(filename) {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Short category → SKU code map for deterministic SKUs.
const CAT_CODE = {
  "Food Packaging": "FOOD", "Mailer Boxes": "MLR", "Corrugated Boxes": "COR",
  "Gift Boxes": "GFT", "Retail Packaging": "RTL", "Pouches & Bags": "POU",
  "Cans & Tins": "CAN", "Jars": "JAR", "Pharma Packaging": "PHR",
  "Tubes": "TUB", "Tapes": "TAP", "Containers & Bowls": "CTR",
};

export function skuCodeForCategory(category) {
  return CAT_CODE[category] ?? (category ? category.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() : "GEN");
}

// Does a filename already contain a usable SKU? (e.g. "ZOLO-PIZ-001.jpg")
export function skuFromFilename(filename) {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const m = /^([A-Z]{2,6}-[A-Z]{2,4}-\d{2,4})$/i.exec(base.trim());
  return m ? m[1].toUpperCase() : null;
}

/**
 * Analyze a single image by filename. `knownCategories` (lowercased names) lets
 * us flag a suggested category as new. Returns a structured, HONEST analysis.
 */
export function analyzeByFilename(filename, { knownCategories = [] } = {}) {
  const phrase = normalizeName(filename);
  const embeddedSku = skuFromFilename(filename);

  // Opaque name (e.g. "prd 001") with no KB signal → REVIEW_REQUIRED, no fakery.
  const match = KB.find((entry) => entry.kw.some((k) => phrase.includes(k)));
  if (!match) {
    return {
      status: "REVIEW_REQUIRED",
      reviewReason: "Unable to confidently identify the product from the image filename.",
      name: null,
      suggestedSku: embeddedSku,
      category: null,
      isNewCategory: false,
      productType: null,
      material: null,
      color: null,
      shape: null,
      usage: [],
      description: null,
      shortDescription: null,
      tags: [],
      seoTitle: null,
      seoDescription: null,
      confidence: { overall: 20, name: 15, category: 15, material: 10 },
      unknown: unknownSpecs(),
    };
  }

  const name = titleCase(phrase.length <= 60 ? phrase : match.type);
  const color = COLOR_HINTS.find((c) => c.kw.some((k) => phrase.includes(k)))?.color ?? null;
  const known = new Set(knownCategories.map((c) => c.toLowerCase()));
  const isNewCategory = !known.has(match.cat.toLowerCase());

  // Match specificity → confidence (multi-word keyword = more specific).
  const matchedKw = match.kw.find((k) => phrase.includes(k)) ?? "";
  const specificity = matchedKw.split(" ").length >= 2 ? 94 : 84;

  const shortDescription = `${name} — practical ${match.type.toLowerCase()} for ${primaryUse(match.cat)}.`;
  const description = buildDescription(name, match, color);
  const seoTitle = `${name} | ${match.cat} | Zolo Packaging`;
  const seoDescription = `Shop ${name.toLowerCase()} designed for ${primaryUse(match.cat)}. Professional ${match.type.toLowerCase()} from Zolo Packaging — customisable for your brand.`;

  return {
    status: "ANALYZED",
    reviewReason: null,
    name,
    suggestedSku: embeddedSku, // filled with a generated SKU later if null
    category: match.cat,
    isNewCategory,
    productType: match.type,
    material: match.material, // visually inferred; admin-confirmable
    color, // may be null (unknown)
    shape: null, // not reliably knowable from a name
    usage: usageFor(match.cat, match.type),
    description,
    shortDescription,
    tags: dedupeTags(match.tags),
    seoTitle,
    seoDescription,
    confidence: {
      overall: specificity,
      name: specificity,
      category: isNewCategory ? Math.min(specificity, 70) : specificity + 2,
      material: specificity - 12, // material is inferred, less certain
    },
    unknown: unknownSpecs(),
  };
}

// Specs that a filename can NEVER reveal — always surfaced as unknown so the
// admin knows to confirm, and so no false claims reach the catalog.
function unknownSpecs() {
  return {
    dimensions: "Not specified",
    gsm: "Not specified",
    weight: "Not specified",
    capacity: "Not specified",
    certifications: "Not specified",
    foodGrade: "Requires confirmation",
  };
}

const USE_BY_CAT = {
  "Food Packaging": "food takeaway and delivery",
  "Containers & Bowls": "food service and beverages",
  "Mailer Boxes": "e-commerce shipping",
  "Corrugated Boxes": "shipping and storage",
  "Gift Boxes": "gifting and premium retail",
  "Retail Packaging": "retail and product presentation",
  "Pouches & Bags": "flexible product packaging",
  "Cans & Tins": "food and beverage packaging",
  "Jars": "food and product storage",
  "Pharma Packaging": "pharmaceutical packaging",
  "Tubes": "cosmetic and personal-care packaging",
  "Tapes": "carton sealing and packing",
};
const primaryUse = (cat) => USE_BY_CAT[cat] ?? "packaging applications";

function usageFor(cat, type) {
  const base = [primaryUse(cat)];
  if (/box|mailer/i.test(type)) base.push("retail and gifting");
  return base;
}

function buildDescription(name, match, color) {
  const colorClause = color ? ` Its ${color.toLowerCase()} finish gives the packaging a clean, presentable appearance.` : "";
  return (
    `Designed for ${primaryUse(match.cat)}, the ${name} is a practical ${match.type.toLowerCase()} ` +
    `made from ${match.material.toLowerCase()}. It offers reliable protection and a professional look, ` +
    `suitable for businesses that need dependable ${match.cat.toLowerCase()}.${colorClause} ` +
    `Dimensions, GSM and other specifications are not specified from the image and can be confirmed during setup.`
  );
}

function dedupeTags(tags) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
