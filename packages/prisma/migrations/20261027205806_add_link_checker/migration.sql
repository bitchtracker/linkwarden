-- CreateEnum
CREATE TYPE "LinkCheckStatus" AS ENUM ('OK', 'BROKEN', 'RESTRICTED', 'UNREACHABLE');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "checkError" TEXT,
ADD COLUMN     "checkFailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "checkStatus" "LinkCheckStatus",
ADD COLUMN     "checkStatusCode" INTEGER,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "linkCheckIntervalDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "linkCheckerEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Link_lastCheckedAt_idx" ON "Link"("lastCheckedAt");
