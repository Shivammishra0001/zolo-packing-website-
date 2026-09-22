-- Additive indexes for the admin category product views
-- (GET /products?categoryId=&page=&limit=8). No data changes.
CREATE INDEX IF NOT EXISTS "Product_categoryId_deletedAt_createdAt_idx" ON "Product"("categoryId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_subcategoryId_deletedAt_createdAt_idx" ON "Product"("subcategoryId", "deletedAt", "createdAt");
