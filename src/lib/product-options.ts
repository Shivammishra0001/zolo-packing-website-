// ============================================================
// Product option normalization — sizes, colours, multi-value cells.
//
// The Product table stores Size and Colour as ONE string column each
// (`sizeLabel`, `color`). Real rows hold every shape an admin has ever typed:
//
//   color:     "Natural Kraft" | "Yellow / Black" | "Brown, White, Black"
//   sizeLabel: null | "12 x 10 x 8 in | 16 x 12 x 10 in" | "6x6x4, 8x8x6"
//
// This module is the ONLY place that parses those strings. The product form,
// bulk importer, product card and detail page all call it, so "6x6x4|8x8x6"
// can never be a chip list in one screen and a blank label in another.
//
// Rules (kept in sync with server/src/services/catalog-normalize.mjs):
//   • separators: comma, pipe, semicolon, newline
//   • " / " is NOT a separator — "Yellow / Black" is one two-tone colour and
//     "1/2 inch" is one size, both of which exist in the live catalog
//   • values are trimmed, blanks dropped, duplicates removed (case-insensitive,
//     first spelling wins), order preserved
//   • canonical stored form is comma-separated: "6x6x4, 8x8x6, 10x8x6"
// ============================================================

export const MULTI_VALUE_SEPARATOR = /\s*[,|;\r\n]+\s*/;

/** Canonical joiner for writing a list back into the existing string column. */
export const MULTI_VALUE_JOINER = ", ";

/** Hard cap so a pasted paragraph cannot turn into hundreds of chips. */
export const MAX_OPTION_VALUES = 50;

/** Placeholders spreadsheets use for "nothing" (mirrors the importer). */
const BLANK_TOKENS = new Set(["", "-", "--", "—", "–", "n/a", "na", "n.a.", "null", "nil", "none", "tbd", "?"]);

const isBlankToken = (s: string) => BLANK_TOKENS.has(s.trim().toLowerCase());

/**
 * Split a stored or typed multi-value field into clean, de-duplicated values.
 * Accepts the existing formats — an array, a comma/pipe/semicolon/newline
 * separated string, or a single plain value — and null/undefined.
 */
export function splitMultiValue(raw: unknown): string[] {
  if (raw == null) return [];
  const parts: string[] = Array.isArray(raw)
    ? raw.flatMap((v) => splitMultiValue(v))
    : String(raw).split(MULTI_VALUE_SEPARATOR);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value || isBlankToken(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_OPTION_VALUES) break;
  }
  return out;
}

/** Inverse of splitMultiValue: the canonical string for the existing column. */
export function joinMultiValue(values: readonly string[] | null | undefined): string | null {
  const clean = splitMultiValue(values ?? []);
  return clean.length ? clean.join(MULTI_VALUE_JOINER) : null;
}

export interface DimensionsLike {
  length: number;
  width: number;
  height: number;
  unit: string;
}

/** "12×10×8 in" — the one display form for structured dimensions. */
export function formatDimensions(d: DimensionsLike | null | undefined): string | null {
  if (!d) return null;
  return `${d.length}×${d.width}×${d.height} ${d.unit}`;
}

/**
 * All sizes a product offers, as chips. Reads the existing `sizeLabel` column
 * (any of the formats above) and falls back to the structured L×W×H when a
 * product has dimensions but no label. Empty array = the product has no size
 * information; callers hide the "Sizes" label rather than printing a blank.
 */
export function normalizeProductSizes(
  sizeLabel: unknown,
  dimensions?: DimensionsLike | null,
): string[] {
  const fromLabel = splitMultiValue(sizeLabel);
  if (fromLabel.length) return fromLabel;
  const dims = formatDimensions(dimensions);
  return dims ? [dims] : [];
}

/** All colours a product offers, from the existing `color` column. */
export function normalizeProductColors(color: unknown): string[] {
  return splitMultiValue(color);
}

/**
 * Card-friendly summary: "6x6x4 • 8x8x6 • 10x8x6" plus "+N more" past `max`.
 * Returns null when there is nothing to show so the label itself can be
 * omitted (never "Sizes:" followed by nothing).
 */
export function summarizeOptions(values: readonly string[], max = 3, joiner = " • "): string | null {
  if (!values.length) return null;
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(joiner)} +${rest} more` : shown.join(joiner);
}
