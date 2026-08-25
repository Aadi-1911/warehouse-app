-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "actualPayable" DECIMAL(65,30),
ADD COLUMN     "discountApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discountPercent" DECIMAL(65,30),
ADD COLUMN     "finalAmount" DECIMAL(65,30),
ADD COLUMN     "gstApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstPercent" DECIMAL(65,30),
ADD COLUMN     "preTaxAmount" DECIMAL(65,30);
