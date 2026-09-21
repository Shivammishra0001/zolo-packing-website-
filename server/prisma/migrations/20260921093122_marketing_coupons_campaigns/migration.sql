-- CreateEnum
CREATE TYPE "CouponScope" AS ENUM ('all', 'products', 'categories');

-- CreateEnum
CREATE TYPE "CampaignContentType" AS ENUM ('text', 'image', 'quote', 'text_image', 'promo_card');

-- CreateEnum
CREATE TYPE "CampaignPlacementKey" AS ENUM ('announcement_bar', 'homepage_hero', 'homepage_promo_card', 'homepage_popup', 'product_listing', 'product_detail', 'cart', 'checkout');

-- CreateEnum
CREATE TYPE "CampaignCtaType" AS ENUM ('none', 'product', 'category', 'shop', 'cart', 'external');

-- CreateEnum
CREATE TYPE "CampaignPopupPosition" AS ENUM ('center', 'bottom_right', 'bottom_left');

-- CreateEnum
CREATE TYPE "CampaignPopupFrequency" AS ENUM ('every_visit', 'once_per_session', 'once_per_day', 'once_per_campaign', 'always');

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "allowOtherDiscounts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowSaleItems" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "appliesTo" "CouponScope" NOT NULL DEFAULT 'all',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "usageLimitPerCustomer" INTEGER DEFAULT 1;

-- CreateTable
CREATE TABLE "CouponProduct" (
    "couponId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "CouponProduct_pkey" PRIMARY KEY ("couponId","productId")
);

-- CreateTable
CREATE TABLE "CouponCategory" (
    "couponId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CouponCategory_pkey" PRIMARY KEY ("couponId","categoryId")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" "CampaignContentType" NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "description" TEXT,
    "quote" TEXT,
    "quoteAuthor" TEXT,
    "imageUrl" TEXT,
    "mobileImageUrl" TEXT,
    "imageAlt" TEXT,
    "badgeText" TEXT,
    "buttonText" TEXT,
    "ctaType" "CampaignCtaType" NOT NULL DEFAULT 'none',
    "ctaProductId" TEXT,
    "ctaCategoryId" TEXT,
    "ctaUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "popupPosition" "CampaignPopupPosition" NOT NULL DEFAULT 'center',
    "popupFrequency" "CampaignPopupFrequency" NOT NULL DEFAULT 'once_per_session',
    "popupDelaySeconds" INTEGER NOT NULL DEFAULT 3,
    "popupAllowClose" BOOLEAN NOT NULL DEFAULT true,
    "popupOverlay" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPlacement" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "placement" "CampaignPlacementKey" NOT NULL,

    CONSTRAINT "CampaignPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CouponProduct_productId_idx" ON "CouponProduct"("productId");

-- CreateIndex
CREATE INDEX "CouponCategory_categoryId_idx" ON "CouponCategory"("categoryId");

-- CreateIndex
CREATE INDEX "Campaign_isActive_startAt_endAt_idx" ON "Campaign"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "Campaign_priority_idx" ON "Campaign"("priority");

-- CreateIndex
CREATE INDEX "CampaignPlacement_placement_idx" ON "CampaignPlacement"("placement");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlacement_campaignId_placement_key" ON "CampaignPlacement"("campaignId", "placement");

-- CreateIndex
CREATE INDEX "Coupon_validFrom_validUntil_idx" ON "Coupon"("validFrom", "validUntil");

-- AddForeignKey
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponProduct" ADD CONSTRAINT "CouponProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCategory" ADD CONSTRAINT "CouponCategory_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCategory" ADD CONSTRAINT "CouponCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ctaProductId_fkey" FOREIGN KEY ("ctaProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ctaCategoryId_fkey" FOREIGN KEY ("ctaCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPlacement" ADD CONSTRAINT "CampaignPlacement_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
