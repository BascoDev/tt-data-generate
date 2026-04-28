-- CreateTable
CREATE TABLE "InventorySyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "processedProducts" INTEGER NOT NULL DEFAULT 0,
    "metafieldsWritten" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "errors" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "InventorySyncJob_shop_idx" ON "InventorySyncJob"("shop");

-- CreateIndex
CREATE INDEX "InventorySyncJob_status_idx" ON "InventorySyncJob"("status");
