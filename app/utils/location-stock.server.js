import prisma from "../db.server";

/**
 * Sanitize a location name to be used as a metafield key.
 * Converts to lowercase, replaces non-alphanumeric chars with underscores.
 */
export function sanitizeLocationName(name) {
  if (!name) return "";
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `tt-stock-${base}` : "";
}

/**
 * Fetch all locations for the shop
 */
export async function fetchLocations(admin) {
  const response = await admin.graphql(
    `#graphql
    query GetLocations {
      locations(first: 250) {
        edges {
          node {
            id
            name
            address {
              city
              province
              country
            }
          }
        }
      }
    }`
  );
  const data = await response.json();
  return data.data?.locations?.edges?.map((edge) => edge.node) || [];
}

/**
 * Ensure a Product Metafield Definition exists for a location.
 * Returns the metafieldDefinitionId (GID).
 *
 * Access is intentionally omitted: smartCollectionCondition capability has
 * strict access requirements that conflict with explicit overrides, so we
 * let Shopify pick defaults compatible with the capability.
 */
export async function ensureLocationMetafieldDefinition(admin, locationId, locationName) {
  const key = sanitizeLocationName(locationName) || `loc_${locationId}`;

  // First, check if definition already exists
  const checkResponse = await admin.graphql(
    `#graphql
    query GetMetafieldDefinition($namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: $namespace, key: $key) {
        edges {
          node {
            id
            name
            namespace
            key
          }
        }
      }
    }`,
    { variables: { namespace: "custom", key } }
  );
  const checkData = await checkResponse.json();
  if (checkData.errors?.length > 0) {
    throw new Error(`Metafield definition query failed: ${checkData.errors.map((e) => e.message).join(", ")}`);
  }
  const existing = checkData.data?.metafieldDefinitions?.edges?.[0]?.node;
  if (existing) {
    return existing.id;
  }

  // Create new definition
  const createResponse = await admin.graphql(
    `#graphql
    mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        definition: {
          name: `Stock: ${locationName}`,
          namespace: "custom",
          key,
          type: "number_integer",
          ownerType: "PRODUCT",
          capabilities: {
            smartCollectionCondition: {
              enabled: true,
            },
          },
        },
      },
    }
  );
  const createData = await createResponse.json();
  if (createData.errors?.length > 0) {
    throw new Error(`Metafield definition creation GraphQL error: ${createData.errors.map((e) => e.message).join(", ")}`);
  }
  if (createData.data?.metafieldDefinitionCreate?.userErrors?.length > 0) {
    const errors = createData.data.metafieldDefinitionCreate.userErrors;
    throw new Error(`Metafield definition creation failed: ${errors.map((e) => e.message).join(", ")}`);
  }
  return createData.data?.metafieldDefinitionCreate?.createdDefinition?.id;
}

/**
 * Delete a Product Metafield Definition by its GID.
 */
export async function deleteLocationMetafieldDefinition(admin, metafieldDefinitionId) {
  if (!metafieldDefinitionId) return false;

  const response = await admin.graphql(
    `#graphql
    mutation DeleteMetafieldDefinition($id: ID!) {
      metafieldDefinitionDelete(id: $id) {
        deletedDefinitionId
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: metafieldDefinitionId } }
  );
  const data = await response.json();
  if (data.data?.metafieldDefinitionDelete?.userErrors?.length > 0) {
    const errors = data.data.metafieldDefinitionDelete.userErrors;
    throw new Error(`Metafield definition deletion failed: ${errors.map((e) => e.message).join(", ")}`);
  }
  return !!data.data?.metafieldDefinitionDelete?.deletedDefinitionId;
}

/**
 * Sync inventory to the per-location product metafield.
 * Writes the webhook-supplied `available` value directly. The metafield mirrors
 * the location's available count for that inventory item.
 */
export async function syncInventoryToMetafield(admin, shop, inventoryItemId, locationId, available) {
  const inventoryItemGid = String(inventoryItemId).startsWith("gid://")
    ? String(inventoryItemId)
    : `gid://shopify/InventoryItem/${inventoryItemId}`;

  const locConfig = await prisma.locationConfig.findUnique({
    where: { shop_locationId: { shop, locationId: String(locationId) } },
  });
  const metafieldKey = locConfig?.metafieldKey || `loc_${locationId}`;

  const productResponse = await admin.graphql(
    `#graphql
    query GetProductFromInventoryItem($inventoryItemId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        id
        variant {
          id
          product { id }
        }
      }
    }`,
    { variables: { inventoryItemId: inventoryItemGid } }
  );
  const productData = await productResponse.json();
  const product = productData.data?.inventoryItem?.variant?.product;
  if (!product) return null;

  await writeProductLocationMetafield(admin, product.id, metafieldKey, available ?? 0);
  return product.id;
}

/**
 * Write a single per-location stock metafield on a product via metafieldsSet.
 */
async function writeProductLocationMetafield(admin, productGid, key, value) {
  const resp = await admin.graphql(
    `#graphql
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productGid,
            namespace: "custom",
            key,
            type: "number_integer",
            value: String(value),
          },
        ],
      },
    }
  );
  const data = await resp.json();
  const errs = data.data?.metafieldsSet?.userErrors;
  if (errs?.length > 0) {
    throw new Error(`metafieldsSet failed: ${errs.map((e) => e.message).join(", ")}`);
  }
}

/**
 * Walk all products in the shop and refresh per-location stock metafields
 * for every active locationConfig. Use after a Sync Locations to backfill
 * historical inventory into the new metafields. Returns counters.
 */
export async function fullInventorySync(admin, shop) {
  const locationConfigs = await prisma.locationConfig.findMany({
    where: { shop, isActive: true, metafieldDefinitionId: { not: null } },
  });
  if (locationConfigs.length === 0) {
    return { productsScanned: 0, productsUpdated: 0, metafieldsWritten: 0 };
  }

  const locationKeyByGid = new Map();
  for (const lc of locationConfigs) {
    if (lc.metafieldKey) {
      locationKeyByGid.set(`gid://shopify/Location/${lc.locationId}`, lc.metafieldKey);
    }
  }

  let productsScanned = 0;
  let productsUpdated = 0;
  let metafieldsWritten = 0;
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const resp = await admin.graphql(
      `#graphql
      query ProductsWithInventory($cursor: String) {
        products(first: 25, after: $cursor) {
          edges {
            node {
              id
              variants(first: 100) {
                edges {
                  node {
                    inventoryItem {
                      inventoryLevels(first: 50) {
                        edges {
                          node {
                            location { id }
                            quantities(names: ["available"]) { name quantity }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { variables: { cursor } }
    );
    const data = await resp.json();
    const page = data.data?.products;
    if (!page) break;

    const batch = [];
    for (const edge of page.edges) {
      productsScanned += 1;
      const product = edge.node;
      const totals = new Map();
      for (const gid of locationKeyByGid.keys()) totals.set(gid, 0);

      for (const vEdge of product.variants.edges) {
        const levels = vEdge.node.inventoryItem?.inventoryLevels?.edges || [];
        for (const lEdge of levels) {
          const locGid = lEdge.node.location?.id;
          if (!totals.has(locGid)) continue;
          const q = lEdge.node.quantities?.find((x) => x.name === "available")?.quantity || 0;
          totals.set(locGid, totals.get(locGid) + q);
        }
      }

      for (const [locGid, total] of totals) {
        const key = locationKeyByGid.get(locGid);
        if (!key) continue;
        batch.push({
          ownerId: product.id,
          namespace: "custom",
          key,
          type: "number_integer",
          value: String(total),
        });
      }
      productsUpdated += 1;
    }

    // metafieldsSet accepts up to 25 entries per call.
    for (let i = 0; i < batch.length; i += 25) {
      const chunk = batch.slice(i, i + 25);
      const setResp = await admin.graphql(
        `#graphql
        mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        { variables: { metafields: chunk } }
      );
      const setData = await setResp.json();
      const errs = setData.data?.metafieldsSet?.userErrors || [];
      if (errs.length > 0) {
        throw new Error(`metafieldsSet failed: ${errs.map((e) => e.message).join(", ")}`);
      }
      metafieldsWritten += chunk.length;
    }

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return { productsScanned, productsUpdated, metafieldsWritten };
}

/**
 * Fetch all smart collections
 */
export async function fetchSmartCollections(admin) {
  const response = await admin.graphql(
    `#graphql
    query GetSmartCollections {
      collections(first: 250, query: "collection_type:smart", sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            ... on Collection {
              ruleSet {
                appliedDisjunctively
                rules {
                  column
                  relation
                  condition
                }
              }
            }
          }
        }
      }
    }`
  );
  const data = await response.json();
  return data.data?.collections?.edges?.map((edge) => edge.node) || [];
}

/**
 * Update a smart collection's rules
 */
export async function updateCollectionRules(admin, collectionId, rules, appliedDisjunctively) {
  const response = await admin.graphql(
    `#graphql
    mutation UpdateCollectionRules($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection {
          id
          title
          ruleSet {
            appliedDisjunctively
            rules {
              column
              relation
              condition
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          id: collectionId,
          ruleSet: {
            appliedDisjunctively,
            rules,
          },
        },
      },
    }
  );
  const data = await response.json();
  if (data.data?.collectionUpdate?.userErrors?.length > 0) {
    throw new Error(
      `Collection update failed: ${data.data.collectionUpdate.userErrors.map((e) => e.message).join(", ")}`
    );
  }
  return data.data?.collectionUpdate?.collection;
}

/**
 * Create a new smart collection
 */
export async function createSmartCollection(admin, title, rules, appliedDisjunctively) {
  const response = await admin.graphql(
    `#graphql
    mutation CreateSmartCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          handle
          ruleSet {
            appliedDisjunctively
            rules {
              column
              relation
              condition
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          title,
          ruleSet: {
            appliedDisjunctively,
            rules,
          },
        },
      },
    }
  );
  const data = await response.json();
  if (data.data?.collectionCreate?.userErrors?.length > 0) {
    throw new Error(
      `Collection creation failed: ${data.data.collectionCreate.userErrors.map((e) => e.message).join(", ")}`
    );
  }
  return data.data?.collectionCreate?.collection;
}

/**
 * Build smart collection rules: one rule per selected location metafield.
 * AND vs OR is controlled by the caller via `appliedDisjunctively` on the ruleSet.
 */
export function buildCollectionRules(locationConfigs, threshold) {
  return locationConfigs.map((loc) => ({
    column: "PRODUCT_METAFIELD_DEFINITION",
    relation: "GREATER_THAN",
    condition: String(threshold),
    conditionObjectId: loc.metafieldDefinitionId,
  }));
}

/**
 * Get or create LocationConfig records for all shop locations.
 * Also ensures metafield definitions exist.
 */
export async function syncLocationConfigs(admin, shop) {
  const locations = await fetchLocations(admin);
  const results = [];

  for (const location of locations) {
    const locationId = location.id.replace("gid://shopify/Location/", "");
    let config = await prisma.locationConfig.findUnique({
      where: { shop_locationId: { shop, locationId } },
    });

    if (!config) {
      // Create metafield definition
      let metafieldDefinitionId = null;
      try {
        metafieldDefinitionId = await ensureLocationMetafieldDefinition(admin, locationId, location.name);
      } catch (err) {
        console.error(`[LocationConfig] Failed to create metafield definition for ${locationId}:`, err.message);
      }

      config = await prisma.locationConfig.create({
        data: {
          shop,
          locationId,
          locationName: location.name,
          metafieldKey: sanitizeLocationName(location.name) || undefined,
          metafieldDefinitionId,
        },
      });
    } else {
      // Update metafieldKey if location name changed
      const newMetafieldKey = sanitizeLocationName(location.name) || undefined;
      const updates = {};
      if (!config.metafieldKey && newMetafieldKey) {
        updates.metafieldKey = newMetafieldKey;
      }
      if (!config.metafieldDefinitionId) {
        try {
          const metafieldDefinitionId = await ensureLocationMetafieldDefinition(admin, locationId, location.name);
          updates.metafieldDefinitionId = metafieldDefinitionId;
        } catch (err) {
          console.error(`[LocationConfig] Failed to create metafield definition for ${locationId}:`, err.message);
        }
      }
      if (Object.keys(updates).length > 0) {
        config = await prisma.locationConfig.update({
          where: { id: config.id },
          data: updates,
        });
      }
    }

    results.push({
      ...config,
      locationName: location.name,
      address: location.address,
    });
  }

  return results;
}
