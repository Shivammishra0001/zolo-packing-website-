// ============================================================
// Shared option lists + spec helpers for the Create Bulk Quote builder.
//
// These drive the dropdowns in the RFQ form. The chosen values are written into
// each RfqItem's `specs` JSON using the canonical string keys the backend reads
// (dimensions / material / color / printing / category) — see
// server/src/services/whatsapp.mjs formatSpecs and services/matching.mjs — plus
// a few richer keys (productType, colors[], pantone, printingRequired,
// description) the UI uses to re-hydrate the controls.
// ============================================================

export const MATERIALS = [
  "Corrugated",
  "Kraft Paper",
  "Paperboard",
  "Cardboard",
  "Plastic",
  "PET",
  "HDPE",
  "LDPE",
  "PVC",
  "Glass",
  "Aluminium",
  "Tin",
  "Metal",
  "Wood",
  "Fabric",
  "Biodegradable",
  "Compostable",
  "Recycled Paper",
  "Recycled Plastic",
  "Other",
] as const;

export const COLORS = [
  "Brown",
  "White",
  "Black",
  "Red",
  "Blue",
  "Green",
  "Yellow",
  "Orange",
  "Transparent",
  "Clear",
  "Silver",
  "Gold",
  "Natural Kraft",
  "Multi Colour",
  "Custom Colour",
] as const;

export const PRINTING_TYPES = [
  "1 Colour",
  "2 Colour",
  "3 Colour",
  "4 Colour / CMYK",
  "Pantone",
  "Digital Printing",
  "Flexographic",
  "Offset",
  "Screen Printing",
] as const;

export const QUANTITY_UNITS = [
  "pcs",
  "boxes",
  "rolls",
  "bags",
  "bottles",
  "jars",
  "sets",
  "sheets",
  "kg",
  "meters",
] as const;

export const DIMENSION_UNITS = ["mm", "cm", "inch", "meter"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

/** How a product's size is expressed — drives which dimension fields show. */
export type ProductShape = "box" | "circular" | "bottle" | "flat" | "na";

export const PRODUCT_SHAPES: { value: ProductShape; label: string; hint: string }[] = [
  { value: "box", label: "Box / rectangular", hint: "Length × Width × Height" },
  { value: "circular", label: "Circular / tube", hint: "Diameter × Height" },
  { value: "bottle", label: "Bottle / jar", hint: "Diameter × Height + Capacity" },
  { value: "flat", label: "Flat / sheet / label", hint: "Length × Width" },
  { value: "na", label: "Not applicable", hint: "No dimensions" },
];

// ---- Structured dimension value <-> canonical string --------------------

export interface DimensionValue {
  shape: ProductShape;
  length?: string;
  width?: string;
  height?: string;
  diameter?: string;
  capacity?: string;
  unit: DimensionUnit;
}

export const emptyDimension = (): DimensionValue => ({ shape: "box", unit: "inch" });

/** Build the human-readable canonical `specs.dimensions` string the backend
 *  (WhatsApp/admin) displays. Returns "" when nothing meaningful is set. */
export function formatDimensions(d: DimensionValue): string {
  const u = d.unit;
  const n = (v?: string) => (v && v.trim() ? v.trim() : "");
  switch (d.shape) {
    case "na":
      return "";
    case "circular": {
      const dia = n(d.diameter);
      const h = n(d.height);
      if (!dia && !h) return "";
      return `Ø${dia || "?"} × ${h || "?"} ${u}`;
    }
    case "bottle": {
      const dia = n(d.diameter);
      const h = n(d.height);
      const cap = n(d.capacity);
      const size = dia || h ? `Ø${dia || "?"} × ${h || "?"} ${u}` : "";
      return [size, cap ? `${cap} capacity` : ""].filter(Boolean).join(", ");
    }
    case "flat": {
      const l = n(d.length);
      const w = n(d.width);
      if (!l && !w) return "";
      return `${l || "?"} × ${w || "?"} ${u}`;
    }
    case "box":
    default: {
      const l = n(d.length);
      const w = n(d.width);
      const h = n(d.height);
      if (!l && !w && !h) return "";
      return `${l || "?"} × ${w || "?"} × ${h || "?"} ${u}`;
    }
  }
}

/** Are the required dimension fields for this shape filled in? (used by validation) */
export function dimensionsComplete(d: DimensionValue): boolean {
  const has = (v?: string) => Boolean(v && v.trim() && Number(v) > 0);
  switch (d.shape) {
    case "na":
      return true;
    case "circular":
      return has(d.diameter) && has(d.height);
    case "bottle":
      return has(d.diameter) && has(d.height);
    case "flat":
      return has(d.length) && has(d.width);
    case "box":
    default:
      return has(d.length) && has(d.width) && has(d.height);
  }
}
