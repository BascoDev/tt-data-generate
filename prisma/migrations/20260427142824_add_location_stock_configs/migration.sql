-- CreateTable
CREATE TABLE "LocationConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "metafieldDefinitionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CollectionRuleConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionName" TEXT NOT NULL,
    "logicType" TEXT NOT NULL DEFAULT 'AND',
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "locationIds" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LocationConfig_shop_idx" ON "LocationConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "LocationConfig_shop_locationId_key" ON "LocationConfig"("shop", "locationId");

-- CreateIndex
CREATE INDEX "CollectionRuleConfig_shop_idx" ON "CollectionRuleConfig"("shop");
