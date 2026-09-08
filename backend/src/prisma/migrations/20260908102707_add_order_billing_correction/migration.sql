-- CreateEnum
CREATE TYPE "OrderBillingCorrectionReason" AS ENUM ('GST_ADDED_RETROACTIVELY', 'GST_PERCENT_CORRECTED', 'DISCOUNT_ADDED_RETROACTIVELY', 'DISCOUNT_PERCENT_CORRECTED', 'OTHER');

-- CreateTable
CREATE TABLE "OrderBillingCorrection" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "oldDiscountApplicable" BOOLEAN NOT NULL,
    "oldDiscountPercent" DECIMAL(65,30),
    "oldGstApplicable" BOOLEAN NOT NULL,
    "oldGstPercent" DECIMAL(65,30),
    "oldFinalAmount" DECIMAL(65,30),
    "oldActualPayable" DECIMAL(65,30),
    "newDiscountApplicable" BOOLEAN NOT NULL,
    "newDiscountPercent" DECIMAL(65,30),
    "newGstApplicable" BOOLEAN NOT NULL,
    "newGstPercent" DECIMAL(65,30),
    "newFinalAmount" DECIMAL(65,30) NOT NULL,
    "newActualPayable" DECIMAL(65,30) NOT NULL,
    "reason" "OrderBillingCorrectionReason" NOT NULL,
    "note" TEXT,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBillingCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderBillingCorrection_orderId_idx" ON "OrderBillingCorrection"("orderId");

-- AddForeignKey
ALTER TABLE "OrderBillingCorrection" ADD CONSTRAINT "OrderBillingCorrection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBillingCorrection" ADD CONSTRAINT "OrderBillingCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
