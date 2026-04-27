import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { logDebug, logError } from "../utils/logger.server";

// Default SKU settings (fallback if database is unavailable)
const DEFAULT_SETTINGS = {
  skuPrefix: "TT",
  skuLength: 8,
  skuType: "numeric",
  useSeparator: true,
  onlyWhenEmpty: true,
  autoGenerateForProducts: true,
  autoGenerateForVariants: true,
  isActive: true,
};

// Load settings from database for specific shop
async function loadSettings(shop) {
  try {
    const settings = await prisma.shopSettings.findUnique({
      where: { shop }
    });

    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }

    return {
      skuPrefix: settings.skuPrefix !== undefined ? settings.skuPrefix : DEFAULT_SETTINGS.skuPrefix,
      skuLength: settings.skuLength !== undefined ? settings.skuLength : DEFAULT_SETTINGS.skuLength,
      skuType: settings.skuType !== undefined ? settings.skuType : DEFAULT_SETTINGS.skuType,
      useSeparator: settings.useSeparator !== undefined ? settings.useSeparator : DEFAULT_SETTINGS.useSeparator,
      onlyWhenEmpty: settings.onlyWhenEmpty !== undefined ? settings.onlyWhenEmpty : DEFAULT_SETTINGS.onlyWhenEmpty,
      autoGenerateForProducts: settings.autoGenerateForProducts !== undefined ? settings.autoGenerateForProducts : DEFAULT_SETTINGS.autoGenerateForProducts,
      autoGenerateForVariants: settings.autoGenerateForVariants !== undefined ? settings.autoGenerateForVariants : DEFAULT_SETTINGS.autoGenerateForVariants,
      isActive: settings.isActive !== undefined ? settings.isActive : DEFAULT_SETTINGS.isActive,
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

// Save SKU generation history
async function saveSkuHistory(shop, sku, productId, variantId, productTitle) {
  try {
    await prisma.skuHistory.create({
      data: {
        shop,
        sku,
        productId,
        variantId,
        productTitle,
        generatedBy: "webhook-create"
      }
    });
  } catch (error) {
    // Non-critical, continue
  }
}

// Generate numeric SKU
function generateNumericSKU(prefix, length, useSeparator) {
  const validLength = Number(length) > 0 ? Number(length) : 8;
  const min = Math.pow(10, validLength - 1);
  const max = Math.pow(10, validLength) - 1;
  const randomNum = Math.floor(min + Math.random() * (max - min + 1));
  const separator = useSeparator ? "-" : "";
  return `${prefix}${separator}${randomNum.toString().padStart(validLength, "0")}`;
}

// Generate alphanumeric SKU
function generateAlphanumericSKU(prefix, length, useSeparator) {
  const validLength = Number(length) > 0 ? Number(length) : 8;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < validLength; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const separator = useSeparator ? "-" : "";
  return `${prefix}${separator}${result}`;
}

// Generate SKU based on settings
function generateSKU(settings) {
  const prefix = settings.skuPrefix !== undefined ? settings.skuPrefix : "TT";
  const length = Number(settings.skuLength) > 0 ? Number(settings.skuLength) : 8;
  const useSeparator = settings.useSeparator !== false;

  if (settings.skuType === "numeric") {
    return generateNumericSKU(prefix, length, useSeparator);
  } else {
    return generateAlphanumericSKU(prefix, length, useSeparator);
  }
}

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // Extract product data
  const productId = payload.id;
  const productTitle = payload.title;
  const variants = payload.variants || [];
  const variantSkus = variants.map(v => v.sku);

  // Log immediately
  await logDebug(shop, topic, `CREATE: ${productTitle}`, {
    productId,
    variantCount: variants.length,
    skus: variantSkus
  });

  try {
    // Load settings
    const settings = await loadSettings(shop);

    // Check if app is active
    if (!settings.isActive) {
      await logDebug(shop, "webhook-products-create", `SKIP: App disabled`, { productId });
      return new Response(null, { status: 200 });
    }

    // Check if auto-generation is enabled
    if (!settings.autoGenerateForProducts) {
      return new Response(null, { status: 200 });
    }

    // Check if product has variants
    if (variants.length === 0) {
      return new Response(null, { status: 200 });
    }

    // Get admin GraphQL client
    const { admin } = await unauthenticated.admin(shop);
    const productGid = `gid://shopify/Product/${productId}`;

    // Collect variants that need SKU generation
    // For CREATE webhook, use payload SKU directly (Shopify hasn't saved yet)
    const variantsToUpdate = [];
    let skippedCount = 0;
    const skippedDetails = [];

    for (const variant of variants) {
      const variantId = variant.id;
      const variantGid = `gid://shopify/ProductVariant/${variantId}`;
      const payloadSku = variant.sku;

      // Check payload SKU - "0" is Shopify default = no SKU
      const payloadSkuString = String(payloadSku ?? "").trim();
      const hasPayloadSku = payloadSkuString !== "" && payloadSkuString !== "0";

      // Skip if payload has valid SKU
      if (hasPayloadSku) {
        skippedCount++;
        skippedDetails.push({ variantId, payloadSku, reason: "payload_has_sku" });
        continue;
      }

      // Generate new SKU
      let newSku = generateSKU(settings);
      if (!newSku || newSku.trim() === "") {
        newSku = `SKU${Date.now()}${Math.floor(Math.random() * 1000)}`;
      }

      variantsToUpdate.push({
        variantId,
        variantGid,
        newSku,
        payloadSku
      });
    }

    // Batch update all variants
    if (variantsToUpdate.length > 0) {
      const bulkInput = variantsToUpdate.map(v => ({
        id: v.variantGid,
        inventoryItem: {
          sku: v.newSku
        }
      }));

      const response = await admin.graphql(
        `#graphql
        mutation updateVariantSKUs($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              sku
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { productId: productGid, variants: bulkInput } }
      );

      const responseJson = await response.json();

      if (responseJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
        const errors = responseJson.data.productVariantsBulkUpdate.userErrors;
        await logError(shop, "webhook-products-create", "Bulk update error", { errors });
      } else {
        // Save history for all updated variants
        for (const v of variantsToUpdate) {
          await saveSkuHistory(shop, v.newSku, String(productId), String(v.variantId), productTitle);
        }
      }
    }

    // Log summary
    await logDebug(shop, "webhook-products-create", `Summary`, {
      productId,
      generated: variantsToUpdate.length,
      skipped: skippedCount,
      total: variants.length,
      skippedDetails: skippedDetails.length > 0 ? skippedDetails : undefined,
      generatedSkus: variantsToUpdate.length > 0 ? variantsToUpdate.map(v => ({ id: v.variantId, sku: v.newSku })) : undefined
    });

    return new Response(null, { status: 200 });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    await logError(shop, "webhook-products-create", `Error: ${errorMessage}`, { error: error?.stack });
    return new Response(null, { status: 200 });
  }
};
