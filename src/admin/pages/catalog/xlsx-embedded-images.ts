// ============================================================
// Embedded-image extraction for XLSX workbooks.
//
// SheetJS parses cell values but discards the drawing layer, so images that
// live *inside* the workbook (rather than as filenames in an Image column) are
// invisible to it. This module reads the OOXML package directly and recovers
// them, anchored to the worksheet row they sit on.
//
// An .xlsx is a ZIP:
//   xl/worksheets/sheet1.xml            — cells, plus a <drawing r:id="..."/> ref
//   xl/worksheets/_rels/sheet1.xml.rels — that r:id → xl/drawings/drawing1.xml
//   xl/drawings/drawing1.xml            — anchors: image → (row, col)
//   xl/drawings/_rels/drawing1.xml.rels — r:embed → xl/media/imageN.jpeg
//   xl/media/*                          — the actual image bytes
//
// Namespace note: Excel writes anchors as <xdr:twoCellAnchor>, but other
// writers (including the generator of the Zolo catalog) emit them unprefixed
// as <oneCellAnchor>. We therefore match tags prefix-agnostically — assuming
// the `xdr:` prefix is exactly what makes naive extractors find zero images.
// ============================================================
import { unzipSync } from "fflate";
import { IMAGE_EXTS, LIMITS, type ZipImage } from "./bulk-import-lib";

/** An image recovered from the workbook, tagged with the row it is anchored to. */
export interface EmbeddedImage extends ZipImage {
  /** 0-indexed worksheet row from the drawing anchor. */
  anchorRow: number;
  /** 0-indexed worksheet column from the drawing anchor. */
  anchorCol: number;
}

const textDecoder = new TextDecoder("utf-8");

/** Read a zip entry as text, tolerating absolute ("/xl/...") target paths. */
function readEntry(files: Record<string, Uint8Array>, path: string): string | undefined {
  const clean = path.replace(/^\//, "");
  const hit = files[clean];
  return hit ? textDecoder.decode(hit) : undefined;
}

/** Resolve a relationship id → target path from a .rels document. */
function relationshipMap(xml: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  // Attribute order varies between writers, so capture the tag then pick out
  // Id/Target independently rather than assuming a fixed sequence.
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (id && target) out.set(id, target);
  }
  return out;
}

/** Resolve a relationship target that may be relative to its owning part. */
function resolveTarget(target: string, ownerDir: string): string {
  if (target.startsWith("/")) return target.replace(/^\//, "");
  if (target.startsWith("../")) {
    const parent = ownerDir.split("/").slice(0, -1).join("/");
    return `${parent}/${target.slice(3)}`.replace(/^\//, "");
  }
  return `${ownerDir}/${target}`.replace(/^\//, "");
}

const ext4 = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";

/**
 * Extract images embedded in the first worksheet of an xlsx workbook.
 *
 * Returns an empty array (never throws) when the file is not a zip, has no
 * drawing layer, or holds no images — callers treat "no embedded images" as a
 * normal case and fall back to Image-column / ZIP matching.
 */
export function extractEmbeddedImages(data: Uint8Array): EmbeddedImage[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    return []; // .xls / .csv / corrupt — nothing embedded to find
  }

  // 1. First worksheet → its drawing part.
  const sheetPath = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort()[0];
  if (!sheetPath) return [];

  const sheetXml = readEntry(files, sheetPath);
  if (!sheetXml) return [];
  const drawingRelId = /<drawing\b[^>]*r:id="([^"]+)"/i.exec(sheetXml)?.[1];
  if (!drawingRelId) return []; // worksheet has no drawing layer

  const sheetDir = sheetPath.split("/").slice(0, -1).join("/");
  const sheetRels = relationshipMap(readEntry(files, `${sheetDir}/_rels/${sheetPath.split("/").pop()}.rels`));
  const drawingTarget = sheetRels.get(drawingRelId);
  if (!drawingTarget) return [];

  const drawingPath = resolveTarget(drawingTarget, sheetDir);
  const drawingXml = readEntry(files, drawingPath);
  if (!drawingXml) return [];

  // 2. Drawing rels: r:embed → media part.
  const drawingDir = drawingPath.split("/").slice(0, -1).join("/");
  const drawingRels = relationshipMap(
    readEntry(files, `${drawingDir}/_rels/${drawingPath.split("/").pop()}.rels`),
  );

  // 3. Walk anchors. `[^:>]*:?` makes the tag prefix optional so both
  //    <xdr:oneCellAnchor> (Excel) and <oneCellAnchor> (other writers) match.
  const anchorRe = /<(?:[^\s:>]*:)?(oneCellAnchor|twoCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/(?:[^\s:>]*:)?\1>/g;
  const out: EmbeddedImage[] = [];
  const seenKeys = new Set<string>();

  for (const [, , body] of drawingXml.matchAll(anchorRe)) {
    if (out.length >= LIMITS.MAX_IMAGES) break;

    const embedId = /\br:embed="([^"]+)"/.exec(body)?.[1];
    if (!embedId) continue; // shape/chart anchor, not a picture
    const target = drawingRels.get(embedId);
    if (!target) continue;

    const mediaPath = resolveTarget(target, drawingDir);
    const bytes = files[mediaPath];
    if (!bytes || bytes.length === 0) continue;
    if (bytes.length > LIMITS.IMAGE_MAX_BYTES) continue;

    const ext = ext4(mediaPath);
    if (!(IMAGE_EXTS as readonly string[]).includes(ext === "jpe" ? "jpeg" : ext)) continue;

    // <from> holds the top-left cell. absoluteAnchor has no <from>; such images
    // float free of any row, so they cannot be attributed to a product.
    const from = /<(?:[^\s:>]*:)?from\b[^>]*>([\s\S]*?)<\/(?:[^\s:>]*:)?from>/.exec(body)?.[1];
    if (!from) continue;
    const anchorRow = Number(/<(?:[^\s:>]*:)?row>(\d+)<\/(?:[^\s:>]*:)?row>/.exec(from)?.[1] ?? NaN);
    const anchorCol = Number(/<(?:[^\s:>]*:)?col>(\d+)<\/(?:[^\s:>]*:)?col>/.exec(from)?.[1] ?? NaN);
    if (!Number.isFinite(anchorRow)) continue;

    // Key images by their media filename; a single media part reused by several
    // anchors (Excel dedupes identical pictures) yields one entry per anchor,
    // so disambiguate with the row.
    const baseName = mediaPath.split("/").pop() ?? mediaPath;
    const key = `${baseName}#${anchorRow}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    out.push({
      path: mediaPath,
      base: baseName.replace(/\.[a-z0-9]+$/i, "").toLowerCase(),
      ext: ext === "jpe" ? "jpeg" : ext,
      data: bytes,
      anchorRow,
      anchorCol: Number.isFinite(anchorCol) ? anchorCol : -1,
    });
  }

  return out;
}

/**
 * Index embedded images by the spreadsheet row they are anchored to.
 *
 * Anchor rows are 0-indexed and include the header, so a picture anchored at
 * anchorRow=1 sits on spreadsheet row 2 — the first data row. Keys returned
 * here are 1-indexed spreadsheet rows, matching `ParsedRow.row`.
 */
export function indexEmbeddedImagesByRow(images: EmbeddedImage[]): Map<number, EmbeddedImage[]> {
  const byRow = new Map<number, EmbeddedImage[]>();
  for (const img of images) {
    const sheetRow = img.anchorRow + 1;
    const list = byRow.get(sheetRow);
    if (list) list.push(img);
    else byRow.set(sheetRow, [img]);
  }
  return byRow;
}
