-- CreateEnum
CREATE TYPE "AiAnalysisStatus" AS ENUM ('NOT_ANALYZED', 'ANALYZING', 'ANALYZED', 'REVIEW_REQUIRED', 'FAILED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProductAiAnalysis" (
    "id" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" "AiAnalysisStatus" NOT NULL DEFAULT 'ANALYZED',
    "name" TEXT,
    "suggestedSku" TEXT,
    "category" TEXT,
    "isNewCategory" BOOLEAN NOT NULL DEFAULT false,
    "productType" TEXT,
    "material" TEXT,
    "color" TEXT,
    "shape" TEXT,
    "usage" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "shortDescription" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "imageUrl" TEXT,
    "confidence" JSONB NOT NULL DEFAULT '{}',
    "reviewReason" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAiAnalysis_imageHash_key" ON "ProductAiAnalysis"("imageHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAiAnalysis_productId_key" ON "ProductAiAnalysis"("productId");

-- CreateIndex
CREATE INDEX "ProductAiAnalysis_status_idx" ON "ProductAiAnalysis"("status");

-- AddForeignKey
ALTER TABLE "ProductAiAnalysis" ADD CONSTRAINT "ProductAiAnalysis_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
