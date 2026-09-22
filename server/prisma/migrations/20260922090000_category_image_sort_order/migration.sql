-- Category: admin-uploaded image + explicit display order. Additive only.
ALTER TABLE "Category" ADD COLUMN "image" TEXT,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "Category_parentId_idx";
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");

-- Backfill sortOrder so the storefront keeps the order it showed before this
-- change (busiest categories first, then by name), for parents and children.
WITH counts AS (
  SELECT c."id",
         c."parentId",
         c."name",
         (SELECT count(*) FROM "Product" p
           WHERE p."deletedAt" IS NULL AND p."status" = 'active'
             AND (p."categoryId" = c."id" OR p."subcategoryId" = c."id")) AS n
  FROM "Category" c
),
ranked AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "parentId" ORDER BY n DESC, "name" ASC) AS rn
  FROM counts
)
UPDATE "Category" c SET "sortOrder" = r.rn FROM ranked r WHERE r."id" = c."id";
