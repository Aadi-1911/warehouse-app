-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isCancelled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "isCancelled" BOOLEAN NOT NULL DEFAULT false;
