-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "fileId" TEXT,
ADD COLUMN     "quotationId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'TEXT';
