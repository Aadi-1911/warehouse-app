-- Rule 111 in 05_BUSINESS_RULES.md (2026-09-23) — per-article, per-location cost and selling
-- price, opt-in per article.
--
-- NAMING COLLISION, stated here so nobody loses an hour to it: the migration
-- 20260919090000_add_order_rounding_adjustment's comments also say "rule 111". Those refer to the
-- ROUNDING rule, which was authored on the staging branch as 111 and renumbered to 109 when it
-- shipped to main (commit 9af51eb) — the .sql comments were deliberately left unedited because
-- editing an applied migration's file breaks its _prisma_migrations checksum and makes
-- `migrate deploy` fail. So that file's "rule 111" is stale by design; THIS file's is current.
--
-- Purely additive, and structurally incapable of changing any existing article's behaviour:
--
--   1. Product.hasLocationPricing defaults to FALSE, so every one of the existing rows is created
--      switched off. utils/locationPricing.js checks that flag FIRST and returns Product.costPrice
--      / Product.sellingPrice unchanged when it is false — so no query result from the new table
--      can reach a price calculation for an article nobody has opted in.
--   2. LocationPrice starts empty. Even for an article switched ON, a location with no row falls
--      back to the Product's own price.
--   No backfill, no existing column rewritten, no default price seeded for any location.
--
-- DECIMAL(65,30) for both price columns is Prisma's default for a bare `Decimal` and matches every
-- existing money column in this schema (Product.costPrice/sellingPrice, OrderLineItem.priceAtOrder,
-- Transaction.costPriceSnapshot) — same basis, so a location override and the base price it
-- overrides can never differ in precision.
--
-- Both prices NULLABLE and independent: an article may override cost at a location without
-- overriding selling there, or the reverse. Null means "no override for this field here", NOT
-- rule 8's "pending price" — see the LocationPrice model comment in schema.prisma.
--
-- FK behaviour is Prisma's default ON DELETE RESTRICT on both sides, which is what we want and is
-- worth stating rather than inheriting silently: a Location or Product with price overrides cannot
-- be hard-deleted out from under them. Neither is ever hard-deleted in this app anyway (both use
-- isActive archiving), so RESTRICT is a backstop against a manual/SQL deletion, not a path the
-- application can reach.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "hasLocationPricing" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LocationPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "costPrice" DECIMAL(65,30),
    "sellingPrice" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationPrice_productId_locationId_key" ON "LocationPrice"("productId", "locationId");

-- AddForeignKey
ALTER TABLE "LocationPrice" ADD CONSTRAINT "LocationPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPrice" ADD CONSTRAINT "LocationPrice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
