-- CreateIndex
CREATE UNIQUE INDEX "Factory_name_key" ON "Factory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSize_productId_sizeLabel_key" ON "ProductSize"("productId", "sizeLabel");
