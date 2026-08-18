/*
  Warnings:

  - You are about to drop the column `valueSnapshot` on the `PartyStockReturn` table. All the data in the column will be lost.
  - Added the required column `priceAtReturn` to the `PartyStockReturn` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reason` to the `PartyStockReturn` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "GoodReturnReason" AS ENUM ('NOT_ORDERED', 'SIZE_ISSUE', 'COLOUR_NOT_ORDERED', 'COLOUR_BLEEDING', 'ACCESSORIES_ISSUE', 'OTHER');

-- AlterTable
ALTER TABLE "PartyStockReturn" DROP COLUMN "valueSnapshot",
ADD COLUMN     "priceAtReturn" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "reason" "GoodReturnReason" NOT NULL;
