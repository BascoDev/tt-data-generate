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
  isActive: true,  // Must include this!
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

    // Explicitly extract all fields to ensure they exist
    // Use !== undefined to allow empty string for prefix
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
        generatedBy: "webhook"
      }
    });
  } catch (error) {
    await logError(shop, "webhook-products-update", `Error saving SKU history: ${error.message}`);
  }
}

// Generate numeric SKU
function generateNumericSKU(prefix, length, useSeparator) {
  // Ensure valid length (default to 8 if invalid)
  const validLength = Number(length) > 0 ? Number(length) : 8;
  const min = Math.pow(10, validLength - 1);
  const max = Math.pow(10, validLength) - 1;
  const randomNum = Math.floor(min + Math.random() * (max - min + 1));
  const separator = useSeparator ? "-" : "";
  return `${prefix}${separator}${randomNum.toString().padStart(validLength, "0")}`;
}

// Generate alphanumeric SKU
function generateAlphanumericSKU(prefix, length, useSeparator) {
  // Ensure valid length (default to 8 if invalid)
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
  // Ensure settings have valid values
  // Use !== undefined to allow empty string for prefix
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

  // Extract product data from payload
  const productId = payload.id;
  const productTitle = payload.title;
  const variants = payload.variants || [];
  const variantSkus = variants.map(v => v.sku);

  // Log immediately
  await logDebug(shop, topic, `UPDATE: ${productTitle}`, {
    productId,
    variantCount: variants.length,
    payloadSkus: variantSkus
  });

  try {
    // Load settings from database for this shop
    const settings = await loadSettings(shop);

    // Check if app is active for this shop
    if (!settings.isActive) {
      await logDebug(shop, "webhook-products-update", `SKIP: App disabled`, { productId, isActive: settings.isActive });
      return new Response(null, { status: 200 });
    }

    // Check if auto-generation is enabled
    if (!settings.autoGenerateForProducts && !settings.autoGenerateForVariants) {
      return new Response(null, { status: 200 });
    }

    // Get admin GraphQL client using unauthenticated context (webhook is already authenticated)
    const { admin } = await unauthenticated.admin(shop);

    // Check if product has variants
    if (variants.length === 0) {
      return new Response(null, { status: 200 });
    }

    // Convert product ID to Shopify Global ID format
    const productGid = `gid://shopify/Product/${productId}`;

    // Build variant GIDs for batch query
    const variantGids = variants.map(v => `gid://shopify/ProductVariant/${v.id}`);

    // Batch query all variants' SKUs in ONE call
    let queriedSkus = {};
    try {
      const batchResponse = await admin.graphql(
        `#graphql
        query getVariantSKUs($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              sku
            }
          }
        }`,
        { variables: { ids: variantGids } }
      );
      const batchData = await batchResponse.json();
      if (batchData.data?.nodes) {
        for (const node of batchData.data.nodes) {
          if (node?.id) {
            queriedSkus[node.id] = node.sku;
          }
        }
      }
    } catch (e) {
      // If batch query fails, will use payload SKUs
    }

    // Collect variants that need SKU generation
    const variantsToUpdate = [];
    let skippedCount = 0;
    const skippedDetails = [];

    for (const variant of variants) {
      const variantId = variant.id;
      const variantGid = `gid://shopify/ProductVariant/${variantId}`;
      const payloadSku = variant.sku;

      // Priority: payload first (user's latest input), query as fallback
      const queriedSku = queriedSkus[variantGid];

      // Check payload SKU first (user/plugin is setting this value)
      const payloadSkuString = String(payloadSku ?? "").trim();
      const hasPayloadSku = payloadSkuString !== "" && payloadSkuString !== "0";

      // Check database SKU as fallback
      const dbSkuString = String(queriedSku ?? "").trim();
      const hasDbSku = dbSkuString !== "" && dbSkuString !== "0";

      // Skip if payload has valid SKU (trust user input)
      if (hasPayloadSku) {
        skippedCount++;
        skippedDetails.push({ variantId, payloadSku, queriedSku, reason: "payload_has_sku" });
        continue;
      }

      // Skip if database has valid SKU and onlyWhenEmpty is enabled
      if (hasDbSku && settings.onlyWhenEmpty) {
        skippedCount++;
        skippedDetails.push({ variantId, payloadSku, queriedSku, reason: "db_has_sku" });
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
        payloadSku,
        queriedSku
      });
    }

    // Batch update all variants in ONE call
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
        await logError(shop, "webhook-products-update", "Bulk update error", { errors });
      } else {
        // Save history for all updated variants
        for (const v of variantsToUpdate) {
          await saveSkuHistory(shop, v.newSku, String(productId), String(v.variantId), productTitle);
        }
      }
    }

    // Log summary with diagnostic info
    await logDebug(shop, "webhook-products-update", `Summary`, {
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
    const errorStack = error?.stack || "No stack trace";
    await logError(shop, "webhook-products-update", `Error: ${errorMessage}`, { error: errorStack });
    return new Response(null, { status: 200 });
  }
};
