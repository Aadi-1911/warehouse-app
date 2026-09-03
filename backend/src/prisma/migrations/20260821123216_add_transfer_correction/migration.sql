-- CreateEnum
CREATE TYPE "TransferCorrectionReason" AS ENUM ('WRONG_QUANTITY', 'WRONG_FROM_LOCATION', 'WRONG_TO_LOCATION', 'OTHER');

-- CreateTable
CREATE TABLE "TransferCorrection" (
    "id" TEXT NOT NULL,
    "originalTransferId" TEXT NOT NULL,
    "reversalTransferId" TEXT NOT NULL,
    "replacementTransferId" TEXT NOT NULL,
    "reason" "TransferCorrectionReason" NOT NULL,
    "note" TEXT,
    "correctedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferCorrection_originalTransferId_key" ON "TransferCorrection"("originalTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferCorrection_reversalTransferId_key" ON "TransferCorrection"("reversalTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferCorrection_replacementTransferId_key" ON "TransferCorrection"("replacementTransferId");

-- AddForeignKey
ALTER TABLE "TransferCorrection" ADD CONSTRAINT "TransferCorrection_originalTransferId_fkey" FOREIGN KEY ("originalTransferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferCorrection" ADD CONSTRAINT "TransferCorrection_reversalTransferId_fkey" FOREIGN KEY ("reversalTransferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferCorrection" ADD CONSTRAINT "TransferCorrection_replacementTransferId_fkey" FOREIGN KEY ("replacementTransferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferCorrection" ADD CONSTRAINT "TransferCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
