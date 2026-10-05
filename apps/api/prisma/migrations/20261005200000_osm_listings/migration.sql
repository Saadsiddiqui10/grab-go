-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "osmId" TEXT;

-- CreateTable
CREATE TABLE "partner_requests" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_requests_businessId_idx" ON "partner_requests"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_requests_businessId_userId_key" ON "partner_requests"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_osmId_key" ON "businesses"("osmId");

-- AddForeignKey
ALTER TABLE "partner_requests" ADD CONSTRAINT "partner_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_requests" ADD CONSTRAINT "partner_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

