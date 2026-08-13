-- AlterTable: add updatedAt as nullable first so it can be backfilled per-row rather than
-- given a single blanket default. Backfilling with CURRENT_TIMESTAMP (the migration's own
-- execution time) would make every pre-existing row's updatedAt land minutes/hours/days after
-- its real createdAt — exactly the "meaningfully after createdAt" signal the frontend's
-- "edited" label looks for, so every untouched historical row would incorrectly show as edited
-- the moment this migration ran. Backfilling from each row's own createdAt instead means an
-- untouched row's updatedAt == createdAt, same as if @updatedAt had been on the table from the
-- start — only a genuine future edit will ever make the two diverge.
ALTER TABLE "FactoryDebit" ADD COLUMN     "updatedAt" TIMESTAMP(3);
ALTER TABLE "FactoryPayment" ADD COLUMN     "updatedAt" TIMESTAMP(3);

UPDATE "FactoryDebit" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
UPDATE "FactoryPayment" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "FactoryDebit" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "FactoryPayment" ALTER COLUMN "updatedAt" SET NOT NULL;
