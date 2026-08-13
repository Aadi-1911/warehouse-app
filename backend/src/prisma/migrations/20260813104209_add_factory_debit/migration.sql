-- CreateTable
CREATE TABLE "FactoryDebit" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactoryDebit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FactoryDebit" ADD CONSTRAINT "FactoryDebit_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
