-- AlterTable
ALTER TABLE "sri_taxpayer_specials"
  ADD COLUMN IF NOT EXISTS "agents_batch_id" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "special_batch_id" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "rimpe_batch_id" VARCHAR(64);
