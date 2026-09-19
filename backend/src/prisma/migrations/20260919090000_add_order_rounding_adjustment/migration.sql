-- Rule 111 (2026-09-19) — records the whole-rupee rounding now applied to Order.actualPayable.
--
-- Purely additive: three nullable columns, no backfill, no default, no existing value rewritten.
-- That is what makes rule 111 forward-only at the data layer as well as in code — every order
-- billed before this migration keeps its unrounded actualPayable and reads null here, which is the
-- real record that no rounding was applied to it, not a missing value to be filled in later.
--
-- DECIMAL(65,30) is Prisma's default for a bare `Decimal` and matches every existing money column
-- on both tables (verified against information_schema, not assumed) — preTaxAmount, finalAmount,
-- actualPayable, oldActualPayable, newFinalAmount and newActualPayable are all numeric(65,30).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "roundingAdjustment" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "OrderBillingCorrection" ADD COLUMN     "newRoundingAdjustment" DECIMAL(65,30),
ADD COLUMN     "oldRoundingAdjustment" DECIMAL(65,30);
