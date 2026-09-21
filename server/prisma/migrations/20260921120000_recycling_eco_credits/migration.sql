-- Returns & Recycling: recycling rules + requests, Eco Credit ledger, Eco Reward
-- settings, customer-specific coupons.
--
-- HAND-EDITED. Prisma's generated script DROPPED "PointsLedger" and created an
-- empty "EcoCreditTransaction". The ledger is immutable history, so instead the
-- new table is created, every existing row is COPIED across in write order
-- (seq is assigned in that order), and only then is the old table removed.
-- Legacy types map: RECYCLE_REWARD -> RECYCLING_REWARD, REDEMPTION stays, any
-- other legacy type becomes MANUAL_CREDIT / MANUAL_DEBIT by sign.

-- CreateEnum
CREATE TYPE "CouponSource" AS ENUM ('admin', 'eco_reward');

-- CreateEnum
CREATE TYPE "EcoCreditType" AS ENUM ('RECYCLING_REWARD', 'REDEMPTION', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'REVERSAL', 'EXPIRATION');

-- CreateEnum
CREATE TYPE "RecyclingUnit" AS ENUM ('kg', 'g', 'piece', 'litre');

-- CreateEnum
CREATE TYPE "RecyclingStatus" AS ENUM ('PENDING', 'PICKUP_SCHEDULED', 'RECEIVED', 'UNDER_VERIFICATION', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "assignedUserId" TEXT,
ADD COLUMN     "source" "CouponSource" NOT NULL DEFAULT 'admin';

-- CreateTable
CREATE TABLE "EcoCreditTransaction" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "EcoCreditType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "source" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "reason" TEXT,
    "adminNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecyclingRule" (
    "id" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "unit" "RecyclingUnit" NOT NULL,
    "creditsPerUnitX100" INTEGER NOT NULL,
    "minQuantityMilli" INTEGER,
    "maxQuantityMilli" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecyclingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecyclingRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RecyclingStatus" NOT NULL DEFAULT 'PENDING',
    "material" TEXT NOT NULL,
    "unit" "RecyclingUnit" NOT NULL,
    "estimatedQuantityMilli" INTEGER NOT NULL,
    "description" TEXT,
    "pickupName" TEXT,
    "pickupPhone" TEXT,
    "pickupLine1" TEXT,
    "pickupLine2" TEXT,
    "pickupCity" TEXT,
    "pickupState" TEXT,
    "pickupPostalCode" TEXT,
    "pickupCountry" TEXT DEFAULT 'India',
    "pickupScheduledFor" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "verifiedQuantityMilli" INTEGER,
    "condition" TEXT,
    "adminNotes" TEXT,
    "ruleId" TEXT,
    "calculatedCredits" INTEGER,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "ruleMaterial" TEXT,
    "ruleUnit" "RecyclingUnit",
    "ruleCreditsPerUnitX100" INTEGER,
    "creditsAwarded" INTEGER,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "rejectedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecyclingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecyclingFile" (
    "id" TEXT NOT NULL,
    "recyclingRequestId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecyclingFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecyclingStatusHistory" (
    "id" TEXT NOT NULL,
    "recyclingRequestId" TEXT NOT NULL,
    "fromStatus" "RecyclingStatus",
    "toStatus" "RecyclingStatus" NOT NULL,
    "changedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecyclingStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcoRewardSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minCreditsToRedeem" INTEGER,
    "creditsRequired" INTEGER,
    "couponValueMinor" INTEGER,
    "couponValidityDays" INTEGER,
    "couponMinOrderMinor" INTEGER,
    "couponUsageLimit" INTEGER NOT NULL DEFAULT 1,
    "maxUnitsPerRedemption" INTEGER NOT NULL DEFAULT 1,
    "allowCombine" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" "CouponScope" NOT NULL DEFAULT 'all',
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creditExpiryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creditExpiryDays" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcoRewardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EcoCreditTransaction_seq_key" ON "EcoCreditTransaction"("seq");

-- CreateIndex
CREATE INDEX "EcoCreditTransaction_userId_seq_idx" ON "EcoCreditTransaction"("userId", "seq");

-- CreateIndex
CREATE INDEX "EcoCreditTransaction_type_createdAt_idx" ON "EcoCreditTransaction"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EcoCreditTransaction_type_source_referenceId_key" ON "EcoCreditTransaction"("type", "source", "referenceId");

-- CreateIndex
CREATE INDEX "RecyclingRule_isActive_idx" ON "RecyclingRule"("isActive");

-- CreateIndex
CREATE INDEX "RecyclingRule_material_unit_idx" ON "RecyclingRule"("material", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "RecyclingRequest_requestNumber_key" ON "RecyclingRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "RecyclingRequest_userId_createdAt_idx" ON "RecyclingRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecyclingRequest_status_createdAt_idx" ON "RecyclingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RecyclingRequest_material_idx" ON "RecyclingRequest"("material");

-- CreateIndex
CREATE INDEX "RecyclingFile_recyclingRequestId_idx" ON "RecyclingFile"("recyclingRequestId");

-- CreateIndex
CREATE INDEX "RecyclingStatusHistory_recyclingRequestId_createdAt_idx" ON "RecyclingStatusHistory"("recyclingRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Coupon_assignedUserId_idx" ON "Coupon"("assignedUserId");

-- CreateIndex
CREATE INDEX "Coupon_source_idx" ON "Coupon"("source");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcoCreditTransaction" ADD CONSTRAINT "EcoCreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecyclingRequest" ADD CONSTRAINT "RecyclingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecyclingRequest" ADD CONSTRAINT "RecyclingRequest_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RecyclingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecyclingFile" ADD CONSTRAINT "RecyclingFile_recyclingRequestId_fkey" FOREIGN KEY ("recyclingRequestId") REFERENCES "RecyclingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecyclingStatusHistory" ADD CONSTRAINT "RecyclingStatusHistory_recyclingRequestId_fkey" FOREIGN KEY ("recyclingRequestId") REFERENCES "RecyclingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the existing ledger (see header), then retire the old table.
INSERT INTO "EcoCreditTransaction" ("id", "userId", "type", "amount", "balanceAfter", "source", "referenceId", "description", "createdAt")
SELECT "id", "userId",
       (CASE
          WHEN "type" = 'RECYCLE_REWARD' THEN 'RECYCLING_REWARD'
          WHEN "type" IN ('RECYCLING_REWARD', 'REDEMPTION', 'MANUAL_CREDIT', 'MANUAL_DEBIT', 'REVERSAL', 'EXPIRATION') THEN "type"
          WHEN "points" >= 0 THEN 'MANUAL_CREDIT'
          ELSE 'MANUAL_DEBIT'
        END)::"EcoCreditType",
       "points", "balanceAfter", "referenceType", "referenceId", "note", "createdAt"
FROM "PointsLedger"
ORDER BY "createdAt" ASC, "id" ASC;

ALTER TABLE "PointsLedger" DROP CONSTRAINT "PointsLedger_userId_fkey";
DROP TABLE "PointsLedger";
