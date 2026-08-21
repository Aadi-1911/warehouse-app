-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderAdjustmentReason" ADD VALUE 'QUANTITY_CHANGED';
ALTER TYPE "OrderAdjustmentReason" ADD VALUE 'LINE_ADDED';
ALTER TYPE "OrderAdjustmentReason" ADD VALUE 'ORDER_EDITED';
