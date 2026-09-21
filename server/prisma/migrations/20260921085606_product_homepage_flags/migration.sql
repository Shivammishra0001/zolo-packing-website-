-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "featuredOrder" INTEGER,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNewArrival" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "newArrivalOrder" INTEGER;

-- CreateIndex
CREATE INDEX "Product_isFeatured_featuredOrder_idx" ON "Product"("isFeatured", "featuredOrder");

-- CreateIndex
CREATE INDEX "Product_isNewArrival_newArrivalOrder_idx" ON "Product"("isNewArrival", "newArrivalOrder");
