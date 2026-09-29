-- Rule 113 in 05_BUSINESS_RULES.md — the OWNER may change an article's unit price AT BILLING, for
-- that one bill only, behind a PIN. This table is the audit record of those changes.
--
-- NOT amended in place, unlike 20260923090000_add_location_price — that file's header explains the
-- one narrow situation that permitted it and explicitly refuses to be read as precedent. This is a
-- new file for a new table, which is the normal path.
--
-- PURELY ADDITIVE, and structurally incapable of changing any existing order:
--
--   1. It creates ONE new table and alters nothing. No existing column is rewritten, no default
--      is seeded, no backfill runs.
--   2. The table starts empty and stays empty for every order billed without a price change —
--      billOrder writes a row only when a submitted override actually differs from the baseline
--      the server itself resolved (an override equal to the baseline is a no-op and writes
--      nothing, by owner decision 2026-09-25).
--   3. Nothing reads this table to compute money. What a party is charged lives in
--      OrderLineItem.billedUnitPrice and Order.preTaxAmount. This is pure audit, so an empty table
--      cannot change any figure any existing endpoint returns.
--
-- DECIMAL(65,30) is Prisma's default for a bare `Decimal` and matches every other money column in
-- this schema (Product.costPrice/sellingPrice, OrderLineItem.priceAtOrder/billedUnitPrice,
-- LocationPrice.sellingPrice). Same basis throughout, so a recorded baseline and the
-- billedUnitPrice it was replaced by can never differ in precision.
--
-- THREE money columns, not two, and all three NOT NULL. baselineMin/baselineMax are a RANGE
-- because one article's colours on one order genuinely can carry different baselines —
-- priceAtOrder is snapshotted per LINE and PATCH /api/orders/:id/lines re-snapshots it. They are
-- equal in the normal case. NOT NULL throughout because a row can only exist as the result of an
-- override that actually happened, so there is no state in which any of the three is unknown —
-- deliberately unlike OrderBillingCorrection's nullable money columns, which are nullable only to
-- accommodate orders billed before rule 101 existed. This table has no such prehistory.
--
-- NO UNIQUE CONSTRAINT on (orderId, productId). One bill can only override an article once, but
-- that is an application rule about a single request — billOrder rejects a duplicate productId
-- with a 400 rather than silently taking the last one — and a database constraint would also
-- forbid a future re-bill of a reinstated order, which is a different question nobody has decided.
--
-- FK behaviour is Prisma's default ON DELETE RESTRICT on all three sides, stated rather than
-- inherited silently: an Order, Product, or User with override rows cannot be hard-deleted out
-- from under them. Products and Users are never hard-deleted by the app (both use isActive
-- archiving; rule 75 for users, with the narrow "probe" test-account exception), and no endpoint
-- hard-deletes an Order at all — so RESTRICT is a backstop against a manual/SQL deletion, not a
-- path the application can reach. It does mean the test files must delete these rows before their
-- orders, which their cleanup() functions do.

-- CreateTable
CREATE TABLE "OrderPriceOverride" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "articleNoSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "baselineMinUnitPrice" DECIMAL(65,30) NOT NULL,
    "baselineMaxUnitPrice" DECIMAL(65,30) NOT NULL,
    "overriddenUnitPrice" DECIMAL(65,30) NOT NULL,
    "setById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPriceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPriceOverride_orderId_idx" ON "OrderPriceOverride"("orderId");

-- AddForeignKey
ALTER TABLE "OrderPriceOverride" ADD CONSTRAINT "OrderPriceOverride_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPriceOverride" ADD CONSTRAINT "OrderPriceOverride_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPriceOverride" ADD CONSTRAINT "OrderPriceOverride_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
