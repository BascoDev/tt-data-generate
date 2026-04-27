-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "skuPrefix" TEXT NOT NULL DEFAULT 'TT',
    "skuLength" INTEGER NOT NULL DEFAULT 8,
    "skuType" TEXT NOT NULL DEFAULT 'numeric',
    "useSeparator" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateForProducts" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateForVariants" BOOLEAN NOT NULL DEFAULT true,
    "onlyWhenEmpty" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
