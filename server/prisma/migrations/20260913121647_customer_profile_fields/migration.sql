-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerEmail" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "preferences" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "website" TEXT;
