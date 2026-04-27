import { authenticate, unauthenticated } from "../shopify.server";
import { syncInventoryToMetafield } from "../utils/location-stock.server";
import { logDebug, logError } from "../utils/logger.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;
  const available = payload.available;

  await logDebug(shop, topic, `Inventory updated: location=${locationId}, available=${available}`, {
    inventoryItemId,
    locationId,
    available,
  });

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Sync inventory to the per-location product metafield. Smart collection
    // rules referencing this metafield are evaluated by Shopify natively, so
    // both AND and OR (appliedDisjunctively) cases are handled automatically.
    const productId = await syncInventoryToMetafield(admin, shop, inventoryItemId, locationId, available);

    if (!productId) {
      await logDebug(shop, "webhook-inventory-levels-update", `No product found for inventory item ${inventoryItemId}`);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error?.message || String(error);
    await logError(shop, "webhook-inventory-levels-update", `Error: ${message}`, { error: error?.stack });
    // Always return 200 to prevent Shopify retries
    return new Response(null, { status: 200 });
  }
};
