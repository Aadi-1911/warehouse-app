-- CreateEnum
CREATE TYPE "TransactionCorrectionReason" AS ENUM ('WRONG_QUANTITY', 'WRONG_LOCATION', 'WRONG_FACTORY', 'WRONG_PRICE', 'OTHER');

-- CreateTable
CREATE TABLE "TransactionCorrection" (
    "id" TEXT NOT NULL,
    "originalId" TEXT NOT NULL,
    "replacementId" TEXT NOT NULL,
    "reason" "TransactionCorrectionReason" NOT NULL,
    "note" TEXT,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCorrection_originalId_key" ON "TransactionCorrection"("originalId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCorrection_replacementId_key" ON "TransactionCorrection"("replacementId");

-- AddForeignKey
ALTER TABLE "TransactionCorrection" ADD CONSTRAINT "TransactionCorrection_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCorrection" ADD CONSTRAINT "TransactionCorrection_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCorrection" ADD CONSTRAINT "TransactionCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
