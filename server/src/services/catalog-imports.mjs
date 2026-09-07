// Bulk catalog import history & audit.
//
// Records every import run (who, what file, mode, outcome counts, timings) plus
// per-row errors/warnings, so admins get an Import History with downloadable
// error reports — the audit trail the console-only importer never persisted.
// Recording NEVER throws into the import path: an import that succeeded must not
// be reported as failed because history bookkeeping hiccuped.
import { prisma } from "../lib/prisma.mjs";
import { recordEvent } from "./events.mjs";

/**
 * Persist one completed import. `result` is the shape importProducts returns
 * ({ processed, created, updated, skipped, failed, errors:[{sku,level,error}] }).
 */
export async function recordImport({ result, mode = "update", fileName = null, fileSizeBytes = null, actorId = null, sellerId = null, imagesMatched = 0 }) {
  try {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    const errorCount = errors.filter((e) => e.level === "error").length;
    const warningCount = errors.length - errorCount;
    const status = result?.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";

    const record = await prisma.catalogImport.create({
      data: {
        fileName,
        fileSizeBytes: Number.isFinite(fileSizeBytes) ? Math.round(fileSizeBytes) : null,
        mode,
        actorId,
        sellerId,
        status,
        totalRows: result?.processed ?? 0,
        created: result?.created ?? 0,
        updated: result?.updated ?? 0,
        skipped: result?.skipped ?? 0,
        failed: result?.failed ?? 0,
        imagesMatched,
        errorCount,
        warningCount,
        completedAt: new Date(),
        // Cap stored rows so a pathological file can't bloat the table; the
        // count fields above still reflect the true totals.
        errors: {
          create: errors.slice(0, 1000).map((e) => ({
            sku: e.sku ?? null,
            rowNumber: e.row ?? null,
            level: e.level === "error" ? "error" : "warning",
            field: e.field ?? null,
            message: String(e.error ?? e.message ?? "").slice(0, 500),
          })),
        },
      },
    });

    await recordEvent({
      eventType: "catalog.imported",
      actorId,
      entityType: "CatalogImport",
      entityId: record.id,
      metadata: { fileName, mode, created: record.created, updated: record.updated, failed: record.failed },
    });
    return record;
  } catch (e) {
    console.error("[catalog:import:history] failed to record import:", e.message);
    return null;
  }
}

/** Import history, newest first. */
export async function listImports({ take = 50, skip = 0 } = {}) {
  const [rows, total] = await Promise.all([
    prisma.catalogImport.findMany({
      orderBy: { startedAt: "desc" },
      take: Math.min(Number(take) || 50, 200),
      skip: Number(skip) || 0,
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
    }),
    prisma.catalogImport.count(),
  ]);
  return {
    imports: rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      fileSizeBytes: r.fileSizeBytes,
      mode: r.mode,
      status: r.status,
      actor: r.actor ? [r.actor.firstName, r.actor.lastName].filter(Boolean).join(" ") || r.actor.email : "System",
      totalRows: r.totalRows,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
      failed: r.failed,
      imagesMatched: r.imagesMatched,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    })),
    total,
  };
}

/** One import with its recorded row errors/warnings. */
export async function getImport(id) {
  const r = await prisma.catalogImport.findUnique({
    where: { id },
    include: {
      actor: { select: { firstName: true, lastName: true, email: true } },
      errors: { orderBy: { rowNumber: "asc" } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    fileName: r.fileName,
    fileSizeBytes: r.fileSizeBytes,
    mode: r.mode,
    status: r.status,
    actor: r.actor ? [r.actor.firstName, r.actor.lastName].filter(Boolean).join(" ") || r.actor.email : "System",
    totalRows: r.totalRows,
    created: r.created,
    updated: r.updated,
    skipped: r.skipped,
    failed: r.failed,
    imagesMatched: r.imagesMatched,
    errorCount: r.errorCount,
    warningCount: r.warningCount,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    errors: r.errors.map((e) => ({ id: e.id, rowNumber: e.rowNumber, sku: e.sku, level: e.level, field: e.field, message: e.message })),
  };
}
