-- AlterEnum
-- Additive only (unlike Round 11's SAMPLE_OUT/SAMPLE_RETURN removal, which needed the
-- create-new-type-and-swap dance) — Postgres supports ADD VALUE directly. Confirmed safe to run
-- as a plain statement (not wrapped in its own BEGIN/COMMIT): this database runs Postgres 18,
-- and ADD VALUE inside a transaction has been supported since Postgres 12 as long as the new
-- value isn't used within the same transaction it was added in, which it isn't here.
ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- Seed the 11 starting categories (03_DATABASE_SCHEMA.md Round 12). Unlike Color/Factory/
-- Location, which start empty and grow entirely through the app, Category ships with a fixed
-- starting list — so the seed lives in the migration itself, not seed.js, guaranteeing it
-- exists on every environment this migration is ever applied to, not just wherever seed.js
-- happens to be run afterward.
INSERT INTO "Category" ("id", "name", "isActive") VALUES
    ('f3a77fc9-bf32-432d-9db6-6bf996637e7f', 'T-shirts', true),
    ('3fa3386f-0cf6-4d17-a909-1d230d0e25e1', 'Lowers', true),
    ('1e46080f-5d11-4e87-83c9-66227908949d', 'Shirts', true),
    ('881851a4-a206-4017-9fb8-d2e4dd92ff54', 'Coordsets', true),
    ('8340b80d-cf38-4646-be8b-c8ecd9056774', 'Kids', true),
    ('33a49423-9b1c-436a-97bb-eea028e43c6e', 'Shorts', true),
    ('9bb196a5-9cbe-430d-841f-8d928193f167', 'Tracksuits', true),
    ('c44fa31c-53d0-4ccd-8c38-06a4457af4ba', 'Hoodie', true),
    ('558e968a-43b2-49ca-9dc8-4512d1d270bd', 'Jacket', true),
    ('871c8d8a-4ffb-40bb-8a18-2bf30c68618d', 'Sweatshirt', true),
    ('f5c8bed8-c636-4630-9634-5658119229cb', 'Others', true);

-- AlterTable: Product.category (nullable free-text String) -> Product.categoryId (required FK).
-- Sequenced by hand rather than using Prisma's naive diff (which emits a single
-- `DROP COLUMN "category", ADD COLUMN "categoryId" TEXT NOT NULL` — invalid against a non-empty
-- table, since there is no default and no value to satisfy NOT NULL for existing rows). Add
-- nullable, backfill, THEN tighten to NOT NULL, THEN drop the old column — each step is valid
-- against real data on its own.
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

-- Backfill: every existing Product had category = null (a plain nullable string that was never
-- populated in practice), so there is no real free-text value to map onto a real Category name.
-- Defaulting to 'Others' rather than guessing is deliberate — it's the designed catch-all
-- category, not a fabricated classification for real business data. Any article can be
-- recategorized normally once an edit endpoint exists.
UPDATE "Product" SET "categoryId" = 'f5c8bed8-c636-4630-9634-5658119229cb' WHERE "categoryId" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "Product" DROP COLUMN "category";

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "qtySets" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "transferId" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
