-- CreateEnum
CREATE TYPE "SalespersonStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LEFT');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'salesperson';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "salespersonId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "capturedById" TEXT;

-- CreateTable
CREATE TABLE "SalespersonProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "territory" TEXT,
    "branch" TEXT,
    "managerId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "status" "SalespersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalespersonProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderSample" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalespersonProfile_userId_key" ON "SalespersonProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalespersonProfile_employeeId_key" ON "SalespersonProfile"("employeeId");

-- CreateIndex
CREATE INDEX "SalespersonProfile_status_idx" ON "SalespersonProfile"("status");

-- CreateIndex
CREATE INDEX "SalesOrderSample_orderId_idx" ON "SalesOrderSample"("orderId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalespersonProfile" ADD CONSTRAINT "SalespersonProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderSample" ADD CONSTRAINT "SalesOrderSample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
