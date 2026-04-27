-- CreateTable
CREATE TABLE "DebugLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DebugLog_shop_idx" ON "DebugLog"("shop");

-- CreateIndex
CREATE INDEX "DebugLog_createdAt_idx" ON "DebugLog"("createdAt");

-- CreateIndex
CREATE INDEX "DebugLog_source_idx" ON "DebugLog"("source");
