-- AlterTable
ALTER TABLE "Factory" ADD COLUMN     "gstNo" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "costPriceSnapshot" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "FactoryPayment" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryPayment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FactoryPayment" ADD CONSTRAINT "FactoryPayment_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
