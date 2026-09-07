# ZOLO Bulk Catalog Import — Architecture Audit & Gap Map

Date: 2026-09-04. Method: read the existing import stack end to end before writing code (per the brief's "inspect first, reuse, don't rewrite").

## What already exists (do NOT rebuild)

ZOLO already ships a mature, tested bulk-import system. Core files:

- **Frontend engine** `src/admin/pages/catalog/bulk-import-lib.ts` (610 lines) — pure, UI-free: xlsx/xls/csv parsing (header-mapped, case-insensitive), secure ZIP parsing (zip-slip guard, zip-bomb cap, size/count limits), SKU↔image matching (SKU-named files + `SKU-2/-3` gallery + Image column + embedded xlsx images + external URLs), row validation with blocking-error vs warning split, CSV error report, and template/ZIP-example builders. Has its own test files (`bulk-import-lib.test.mjs`, `xlsx-embedded-images.test.mjs`).
- **Frontend UI** `BulkImport.tsx` (admin dialog: drag-drop Excel/CSV/ZIP, options, Validate → preview counts + per-row table → Import, chunked image upload), `GenerateFromImages.tsx` (rule-based AI-ish enrichment), `ImageUpload.tsx`, `CatalogComponents.tsx`.
- **Backend** `server/src/services/catalog.mjs` (`importProducts` — row-isolated create/update/skip by SKU, category/subcategory upsert with archived-restore, slug uniqueness, image preservation), `catalog-normalize.mjs`, routes `POST /products/import`, `/products/:id/image`, `/products/images/bulk`, `/uploads`, `GET/POST/DELETE /categories`.
- **Tests** `server/test/catalog.test.mjs` + `catalog-normalize.test.mjs` (38 cases, passing).

## Phase-by-phase status

| Phase | Feature | Status |
|---|---|---|
| 1 | Audit existing system | ✅ this document |
| 2 | Excel template (multi-sheet) | ◑ single-sheet template exists (Products); no separate Variants/Images/Specs/Categories sheets |
| 3 | Admin bulk import UI | ✅ exists (dialog: upload, options, validate, preview, import) |
| 4 | Validation engine | ✅ exists (required fields, dup-SKU, category, numerics, image ext, status) |
| 5 | Import preview | ✅ exists (counts + per-row create/update/error table) |
| 6 | Create/update by SKU | ✅ exists (`importProducts`, SKU is the business key, never duplicates) |
| 7 | Safe partial import | ✅ exists (row-isolated; one bad row is skipped) |
| 8 | Background processing | ◑ synchronous, capped at 2000 products/500 images; images chunked client-side. No job queue |
| 9 | Image upload to storage | ✅ exists (`/uploads` + `setProductImage`, private/public split) |
| 10 | Image optimization (webp/avif/thumbs) | ✗ stores originals; no server-side resize pipeline |
| 11 | Seller bulk import | ✗ admin-only; no seller-scoped import route/UI |
| 12 | Seller security / ownership | ✗ **and the catalog write API is currently unauthenticated** (see Known Issues) |
| 13 | AI enrichment | ◑ rule-based enrichment (`GenerateFromImages`, `ai-analyzer`); no LLM |
| 14 | Import history | ✅ **implemented this round** |
| 15 | Export catalog (import-compatible xlsx) | ✗ not implemented |
| 16 | DB (imports/import_errors tables) | ✅ **implemented this round** (`CatalogImport`, `CatalogImportError`) |
| 17 | Import API | ✅ exists + history endpoints added this round |
| 18 | Transaction safety | ✅ per-row upsert; category resolution race-safe |
| 19 | Audit log | ✅ **implemented this round** (`catalog.imported` event + records) |
| 20 | Customer-facing result | ✅ imported products flow to listing/detail/cart/RFQ |
| 21 | Product image gallery | ✅ upgraded previously (multi-image thumbnail gallery) |
| 22 | SEO (unique slug) | ✅ `importProducts` enforces unique slugs |
| 23 | Error report (downloadable) | ✅ CSV report (frontend `buildErrorReportCsv` + history error report) |
| 24 | Template download | ◑ single-sheet xlsx + ZIP example; not the 6-sheet formatted workbook |
| 25 | Testing | ✅ catalog + import-history suites |
| 26 | No mock data | ✅ real DB/API/storage |
| 27 | Don't break existing features | ✅ full suite green |

Legend: ✅ done · ◑ partial · ✗ missing.

## Delivered this round (Import History & audit — Phases 14/16/19)

- **DB**: `CatalogImport` (fileName, mode, actor, status, count fields, timings) + `CatalogImportError` (row, sku, level, field, message) + `CatalogImportStatus` enum. Migration `…_catalog_import_history`.
- **Backend**: `services/catalog-imports.mjs` (`recordImport`/`listImports`/`getImport`); `POST /products/import` now records each run (best-effort, never fails the import) and returns `importId`; admin-only `GET /admin/catalog/imports[/:id]`.
- **Frontend**: admin **Import History** page (`/admin/catalog/imports`) with per-import drill-down and downloadable CSV error report; "Import History" link on the Bulk Import control; `importBatch` now sends `fileName`.
- **Tests**: `server/test/catalog-import-history.test.mjs` (4 cases) — success recording, partial-failure `COMPLETED_WITH_ERRORS` with row errors, admin-only access, 404.

## Known issues / recommended next steps (priority order)

1. **CRITICAL — the catalog write API is unauthenticated.** `POST /products/import`, `/products`, `/products/:id/image`, `/categories` are mounted with no `authenticate`/`requireAdmin` (see `app.mjs` — "kept OPEN"). Anyone can bulk-overwrite the catalog today. This is also why import history records `actor = System` (no `req.user`). Fixing it is a coordinated step: guard the product-write router **and** make the admin catalog client (`src/lib/catalog-api.ts`) send the admin bearer token (it currently sends none). This is the correct home for Phase 12 (seller ownership) too.
2. **Seller bulk import (Phase 11)** — after (1): a seller-scoped import that stamps `sellerId`, forces DRAFT→review status, and blocks cross-seller SKU writes.
3. **Export catalog (Phase 15)** — an admin xlsx export in the same shape the importer accepts (export → edit → re-import round-trip).
4. **Multi-sheet template (Phases 2/24)** — Variants/Images/Specs/Categories sheets. Note: the current product model is single-variant with specs folded into description; true variants/specs are a larger data-model change, not just a template change.
5. **Image optimization (Phase 10)** and **background jobs for >2000 rows (Phase 8)**.
