import { authenticate, unauthenticated } from "../shopify.server";
import { syncInventoryToMetafield } from "../utils/location-stock.server";
import { logDebug, logError } from "../utils/logger.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;

  await logDebug(shop, topic, `Inventory disconnected: location=${locationId}`, {
    inventoryItemId,
    locationId,
  });

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Zero out the per-location metafield. Shopify will re-evaluate any smart
    // collection rule that references this location's metafield.
    await syncInventoryToMetafield(admin, shop, inventoryItemId, locationId, 0);

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error?.message || String(error);
    await logError(shop, "webhook-inventory-levels-disconnect", `Error: ${message}`, { error: error?.stack });
    return new Response(null, { status: 200 });
  }
};
