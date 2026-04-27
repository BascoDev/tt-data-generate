/*
  Warnings:

  - You are about to drop the `AppSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AppSettings";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "skuPrefix" TEXT NOT NULL DEFAULT 'TT',
    "skuLength" INTEGER NOT NULL DEFAULT 8,
    "skuType" TEXT NOT NULL DEFAULT 'numeric',
    "useSeparator" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateForProducts" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateForVariants" BOOLEAN NOT NULL DEFAULT true,
    "onlyWhenEmpty" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SkuHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL DEFAULT 'webhook',
    CONSTRAINT "SkuHistory_shop_fkey" FOREIGN KEY ("shop") REFERENCES "ShopSettings" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "appVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "features" TEXT,
    "maxShops" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "ShopSettings_shop_idx" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "SkuHistory_shop_idx" ON "SkuHistory"("shop");

-- CreateIndex
CREATE INDEX "SkuHistory_sku_idx" ON "SkuHistory"("sku");

-- CreateIndex
CREATE INDEX "SkuHistory_generatedAt_idx" ON "SkuHistory"("generatedAt");
