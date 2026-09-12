-- AddForeignKey
ALTER TABLE "PartyDebit" ADD CONSTRAINT "PartyDebit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
