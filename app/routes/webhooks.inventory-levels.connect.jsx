import { authenticate, unauthenticated } from "../shopify.server";
import { syncInventoryToMetafield, ensureLocationMetafieldDefinition, sanitizeLocationName } from "../utils/location-stock.server";
import prisma from "../db.server";
import { logDebug, logError } from "../utils/logger.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const inventoryItemId = payload.inventory_item_id;
  const locationId = payload.location_id;
  const available = payload.available;

  await logDebug(shop, topic, `Inventory connected: location=${locationId}, available=${available}`, {
    inventoryItemId,
    locationId,
    available,
  });

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Ensure location config and metafield definition exist
    let config = await prisma.locationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: String(locationId) } },
    });

    if (!config) {
      // Fetch location name
      const locationResponse = await admin.graphql(
        `#graphql
        query GetLocation($id: ID!) {
          location(id: $id) {
            id
            name
          }
        }`,
        { variables: { id: `gid://shopify/Location/${locationId}` } }
      );
      const locationData = await locationResponse.json();
      const locationName = locationData.data?.location?.name || `Location ${locationId}`;

      let metafieldDefinitionId = null;
      try {
        metafieldDefinitionId = await ensureLocationMetafieldDefinition(admin, locationId, locationName);
      } catch (err) {
        await logError(shop, "webhook-inventory-levels-connect", `Failed to create metafield definition: ${err.message}`);
      }

      config = await prisma.locationConfig.create({
        data: {
          shop,
          locationId: String(locationId),
          locationName,
          metafieldKey: sanitizeLocationName(locationName) || undefined,
          metafieldDefinitionId,
        },
      });
    }

    // Sync initial inventory to metafield
    await syncInventoryToMetafield(admin, shop, inventoryItemId, locationId, available || 0);

    return new Response(null, { status: 200 });
  } catch (error) {
    const message = error?.message || String(error);
    await logError(shop, "webhook-inventory-levels-connect", `Error: ${message}`, { error: error?.stack });
    return new Response(null, { status: 200 });
  }
};
