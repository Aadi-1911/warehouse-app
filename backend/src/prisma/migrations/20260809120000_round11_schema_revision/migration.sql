-- AlterEnum
BEGIN;
CREATE TYPE "TransactionType_new" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'DEFECT_RETURN', 'PARTY_RETURN');
ALTER TABLE "Transaction" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new");
ALTER TYPE "TransactionType" RENAME TO "TransactionType_old";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
DROP TYPE "public"."TransactionType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Color" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Factory" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Stock" DROP COLUMN "qtyReservedForSample";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isCustomComposition" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "partyId" TEXT,
ADD COLUMN     "partyStockReturnId" TEXT;

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopName" TEXT,
    "location" TEXT,
    "address" TEXT,
    "contact" TEXT,
    "gstNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSizeBreakdown" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "sizeLabel" TEXT NOT NULL,
    "qtyPieces" INTEGER NOT NULL,

    CONSTRAINT "TransactionSizeBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoosePieces" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sizeLabel" TEXT NOT NULL,
    "qtyPieces" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LoosePieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyStockReturn" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qtySets" INTEGER NOT NULL,
    "valueSnapshot" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyStockReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoosePieces_bundleId_locationId_sizeLabel_key" ON "LoosePieces"("bundleId", "locationId", "sizeLabel");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyStockReturnId_fkey" FOREIGN KEY ("partyStockReturnId") REFERENCES "PartyStockReturn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSizeBreakdown" ADD CONSTRAINT "TransactionSizeBreakdown_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoosePieces" ADD CONSTRAINT "LoosePieces_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoosePieces" ADD CONSTRAINT "LoosePieces_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyStockReturn" ADD CONSTRAINT "PartyStockReturn_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyStockReturn" ADD CONSTRAINT "PartyStockReturn_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyStockReturn" ADD CONSTRAINT "PartyStockReturn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyStockReturn" ADD CONSTRAINT "PartyStockReturn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateCheckConstraint
-- Prisma 6.19.3 has no `@@check` attribute (verified: `prisma validate` rejects it with P1012,
-- "not a valid field or attribute definition") so this cannot be expressed in schema.prisma and
-- is written here by hand. Prisma's migration engine does not model CHECK constraints, so it
-- neither drops nor re-proposes this on subsequent `migrate diff` runs — it simply persists.
-- Backstop only: the real guarantee is transactionController's atomic guarded updateMany, which
-- rejects an over-decrement before it can ever reach the database. This catches anything that
-- somehow bypasses that path (a raw SQL write, a future controller that forgets the guard).
ALTER TABLE "Stock" ADD CONSTRAINT "stock_qty_sets_non_negative" CHECK ("qtySets" >= 0);
