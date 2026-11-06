-- CreateEnum
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "MarketingService" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "deliverables" TEXT[],
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPackage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "priceMinor" INTEGER,
    "billingPeriod" TEXT NOT NULL DEFAULT 'month',
    "deliverables" TEXT[],
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPackageService" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "MarketingPackageService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" TEXT NOT NULL,
    "leadNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "location" TEXT,
    "services" TEXT[],
    "budgetRange" TEXT,
    "challenges" TEXT,
    "requirement" TEXT,
    "packageId" TEXT,
    "preferredContact" TEXT,
    "bestTimeToContact" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'adsens_web',
    "assignedToId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "convertedUserId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "fromStatus" "MarketingLeadStatus",
    "toStatus" "MarketingLeadStatus",
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingService_slug_key" ON "MarketingService"("slug");

-- CreateIndex
CREATE INDEX "MarketingService_isActive_sortOrder_idx" ON "MarketingService"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPackage_slug_key" ON "MarketingPackage"("slug");

-- CreateIndex
CREATE INDEX "MarketingPackage_isPublished_sortOrder_idx" ON "MarketingPackage"("isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "MarketingPackageService_serviceId_idx" ON "MarketingPackageService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPackageService_packageId_serviceId_key" ON "MarketingPackageService"("packageId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLead_leadNumber_key" ON "MarketingLead"("leadNumber");

-- CreateIndex
CREATE INDEX "MarketingLead_status_createdAt_idx" ON "MarketingLead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_assignedToId_idx" ON "MarketingLead"("assignedToId");

-- CreateIndex
CREATE INDEX "MarketingLead_email_idx" ON "MarketingLead"("email");

-- CreateIndex
CREATE INDEX "MarketingLead_phone_idx" ON "MarketingLead"("phone");

-- CreateIndex
CREATE INDEX "MarketingLead_nextFollowUpAt_idx" ON "MarketingLead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "MarketingLeadActivity_leadId_createdAt_idx" ON "MarketingLeadActivity"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingPackageService" ADD CONSTRAINT "MarketingPackageService_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MarketingPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPackageService" ADD CONSTRAINT "MarketingPackageService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "MarketingService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "MarketingPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_convertedUserId_fkey" FOREIGN KEY ("convertedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLeadActivity" ADD CONSTRAINT "MarketingLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLeadActivity" ADD CONSTRAINT "MarketingLeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
