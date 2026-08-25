-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "productType" TEXT,
ADD COLUMN     "sizeLabel" TEXT,
ADD COLUMN     "subcategoryId" TEXT,
ADD COLUMN     "thickness" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index the new FK: category pages filter on it on every storefront request.
CREATE INDEX "Product_subcategoryId_idx" ON "Product"("subcategoryId");
