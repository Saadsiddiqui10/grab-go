-- Cafe-specific loyalty, and curbside pickup.
--
-- Loyalty moves from one platform-wide Grab Points balance to one card per
-- customer per cafe, and every reward now belongs to a cafe. The data steps
-- below refuse to run (rather than silently drop anything) if the database
-- holds platform balances, platform-ledger history or redeemed platform
-- rewards that cannot be attributed to a cafe.

-- Guard: nothing here may be lost.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "points_accounts" WHERE "balance" <> 0 OR "lifetimeEarned" <> 0) THEN
    RAISE EXCEPTION 'Platform points balances exist; attribute them to cafes before migrating.';
  END IF;
  IF EXISTS (SELECT 1 FROM "points_transactions") THEN
    RAISE EXCEPTION 'Platform points history exists; attribute it to cafes before migrating.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "reward_redemptions" rr JOIN "rewards" r ON r."id" = rr."rewardId"
    WHERE r."businessId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Platform rewards have been redeemed; resolve those before migrating.';
  END IF;
END $$;

-- Platform-wide rewards are retired: only cafes define rewards now.
DELETE FROM "rewards" WHERE "businessId" IS NULL;

-- The referral programme pointed at two of those rewards.
UPDATE "platform_settings"
SET "value" = "value" || '{"refereeRewardId": null, "referrerRewardId": null}'::jsonb
WHERE "key" = 'referral';

-- Empty platform accounts (all zero, checked above). Cafe accounts are
-- created on first earn.
DELETE FROM "points_accounts";

-- CreateEnum
CREATE TYPE "PickupMethod" AS ENUM ('WALK_IN', 'CURBSIDE');

-- DropIndex
DROP INDEX "points_accounts_userId_key";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pickupMethod" "PickupMethod" NOT NULL DEFAULT 'WALK_IN',
ADD COLUMN     "vehicleDetails" TEXT,
ADD COLUMN     "vehiclePlate" TEXT;

-- AlterTable
ALTER TABLE "points_accounts" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "points_transactions" ADD COLUMN     "businessId" TEXT;

-- AlterTable
ALTER TABLE "rewards" ALTER COLUMN "businessId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "points_accounts_businessId_idx" ON "points_accounts"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "points_accounts_userId_businessId_key" ON "points_accounts"("userId", "businessId");

-- CreateIndex
CREATE INDEX "rewards_businessId_isActive_idx" ON "rewards"("businessId", "isActive");

-- AddForeignKey
ALTER TABLE "points_accounts" ADD CONSTRAINT "points_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
