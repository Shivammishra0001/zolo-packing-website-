-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'other',
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "metric1Label" TEXT,
    "metric1Value" TEXT,
    "metric2Label" TEXT,
    "metric2Value" TEXT,
    "isIllustrative" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "caseStudyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCaseStudy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT,
    "industry" TEXT,
    "category" TEXT NOT NULL,
    "coverImage" TEXT,
    "summary" TEXT,
    "overview" TEXT,
    "strategy" TEXT,
    "execution" TEXT,
    "servicesProvided" TEXT[],
    "gallery" TEXT[],
    "results" TEXT[],
    "resultsVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCaseStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_slug_key" ON "MarketingCampaign"("slug");

-- CreateIndex
CREATE INDEX "MarketingCampaign_isPublished_sortOrder_idx" ON "MarketingCampaign"("isPublished", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCaseStudy_slug_key" ON "MarketingCaseStudy"("slug");

-- CreateIndex
CREATE INDEX "MarketingCaseStudy_isPublished_sortOrder_idx" ON "MarketingCaseStudy"("isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "MarketingCaseStudy_category_idx" ON "MarketingCaseStudy"("category");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_caseStudyId_fkey" FOREIGN KEY ("caseStudyId") REFERENCES "MarketingCaseStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
