-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "productNameSnapshot" TEXT;

-- AlterTable
ALTER TABLE "PartyStockReturn" ADD COLUMN     "productNameSnapshot" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "productNameSnapshot" TEXT;
