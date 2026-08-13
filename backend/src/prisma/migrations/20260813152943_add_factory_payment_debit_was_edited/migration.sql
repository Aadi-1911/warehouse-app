-- AlterTable
ALTER TABLE "FactoryDebit" ADD COLUMN     "wasEdited" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FactoryPayment" ADD COLUMN     "wasEdited" BOOLEAN NOT NULL DEFAULT false;
