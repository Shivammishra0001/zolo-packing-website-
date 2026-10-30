-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'pending_review';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "supplierProfileId" TEXT;

-- CreateIndex
CREATE INDEX "Product_supplierProfileId_status_idx" ON "Product"("supplierProfileId", "status");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplierProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
