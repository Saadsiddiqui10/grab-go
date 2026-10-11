-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('APP', 'POS', 'STAFF');

-- CreateEnum
CREATE TYPE "PosProvider" AS ENUM ('NONE', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "PosSyncStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'APP';

-- CreateTable
CREATE TABLE "pos_connections" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "PosProvider" NOT NULL DEFAULT 'NONE',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "endpointUrl" TEXT,
    "secretEncrypted" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sync_jobs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PosSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "lastStatusCode" INTEGER,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_connections_businessId_key" ON "pos_connections"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sync_jobs_eventKey_key" ON "pos_sync_jobs"("eventKey");

-- CreateIndex
CREATE INDEX "pos_sync_jobs_status_nextAttemptAt_idx" ON "pos_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "pos_sync_jobs_businessId_status_createdAt_idx" ON "pos_sync_jobs"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "pos_sync_jobs_orderId_idx" ON "pos_sync_jobs"("orderId");

-- AddForeignKey
ALTER TABLE "pos_connections" ADD CONSTRAINT "pos_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sync_jobs" ADD CONSTRAINT "pos_sync_jobs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sync_jobs" ADD CONSTRAINT "pos_sync_jobs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

