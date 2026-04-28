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

  // deleteAllAssociatedMetafields: true cascades the deletion to every
  // product metafield using this definition. Without it, Shopify only
  // removes the schema and leaves orphaned values on every product.
  const response = await admin.graphql(
    `#graphql
    mutation DeleteMetafieldDefinition($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
      metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
        deletedDefinitionId
        userErrors {
          field
          message
          code
        }
      }
    }`,
    { variables: { id: metafieldDefinitionId, deleteAllAssociatedMetafields: true } }
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
 * Total product count for the shop. Used to render an accurate progress bar.
 */
export async function fetchProductsCount(admin) {
  const resp = await admin.graphql(
    `#graphql
    query ProductsCount {
      productsCount { count }
    }`
  );
  const data = await resp.json();
  return data.data?.productsCount?.count ?? 0;
}

/**
 * Walk every tracked location's inventory and refresh per-location stock
 * metafields on every product. Uses location-driven pagination instead of
 * nested products → variants → inventoryLevels, which keeps single-query
 * cost well under Shopify's 1000-point budget.
 *
 * Two phases:
 *   1. Scan: paginate `location.inventoryLevels` for each tracked location,
 *      accumulate per-product totals into an in-memory map.
 *   2. Write: emit metafieldsSet mutations, 25 entries per call.
 *
 * `onProgress({ productsScanned, metafieldsWritten, errors })` fires at every
 * meaningful checkpoint so the polling UI can render progress.
 * `shouldStop()` is checked between pages and between phases for cancellation.
 */
export async function fullInventorySync(admin, shop, { onProgress, shouldStop } = {}) {
  const locationConfigs = await prisma.locationConfig.findMany({
    where: { shop, isActive: true, metafieldDefinitionId: { not: null } },
  });
  if (locationConfigs.length === 0) {
    return { productsScanned: 0, metafieldsWritten: 0, errors: [] };
  }

  const errors = [];
  let metafieldsWritten = 0;
  // productGid -> Map(metafieldKey -> totalAvailable)
  const productTotals = new Map();
  const trackedKeys = locationConfigs.filter((lc) => lc.metafieldKey).map((lc) => lc.metafieldKey);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isStopped = async () => (shouldStop ? !!(await shouldStop()) : false);
  const reportProgress = async () => {
    if (!onProgress) return;
    try {
      await onProgress({
        productsScanned: productTotals.size,
        metafieldsWritten,
        errors: [...errors],
      });
    } catch (_err) {
      // swallow — progress reporting must never abort the sync
    }
  };

  // --- Phase 0: enumerate every product so we can baseline 0 at each location.
  // This guarantees products with no inventoryLevel at a location still get a
  // 0 metafield (otherwise smart-collection rules using `<` would misbehave).
  {
    let cursor = null;
    let hasNext = true;
    while (hasNext) {
      if (await isStopped()) return { productsScanned: productTotals.size, metafieldsWritten, errors, stopped: true };
      let page = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const resp = await admin.graphql(
            `#graphql
            query AllProductIds($cursor: String) {
              products(first: 250, after: $cursor) {
                edges { node { id } }
                pageInfo { hasNextPage endCursor }
              }
            }`,
            { variables: { cursor } }
          );
          const data = await resp.json();
          const throttled = data.errors?.some((e) => e.extensions?.code === "THROTTLED");
          if (throttled) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          if (data.errors?.length > 0) {
            errors.push(`Product enumeration: ${data.errors.map((e) => e.message).join(", ")}`);
            break;
          }
          page = data.data?.products;
          break;
        } catch (err) {
          if (attempt === 3) {
            errors.push(`Product enumeration crashed: ${err.message}`);
          } else {
            await sleep(1500 * (attempt + 1));
          }
        }
      }
      if (!page) break;

      for (const edge of page.edges) {
        const id = edge.node.id;
        if (!productTotals.has(id)) {
          const m = new Map();
          for (const k of trackedKeys) m.set(k, 0);
          productTotals.set(id, m);
        }
      }
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
      await reportProgress();
    }
  }

  // --- Phase 1: scan each location's inventoryLevels ------------------------
  for (const lc of locationConfigs) {
    if (!lc.metafieldKey) continue;
    const locationGid = `gid://shopify/Location/${lc.locationId}`;
    const key = lc.metafieldKey;

    let cursor = null;
    let hasNext = true;
    while (hasNext) {
      if (await isStopped()) return { productsScanned: productTotals.size, metafieldsWritten, errors, stopped: true };

      let page = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const resp = await admin.graphql(
            `#graphql
            query LocationLevels($id: ID!, $cursor: String) {
              location(id: $id) {
                inventoryLevels(first: 100, after: $cursor) {
                  edges {
                    node {
                      quantities(names: ["available"]) { name quantity }
                      item {
                        variant {
                          product { id }
                        }
                      }
                    }
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }`,
            { variables: { id: locationGid, cursor } }
          );
          const data = await resp.json();
          const throttled = data.errors?.some((e) => e.extensions?.code === "THROTTLED");
          if (throttled) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          if (data.errors?.length > 0) {
            errors.push(`location(${lc.locationName}) levels query: ${data.errors.map((e) => e.message).join(", ")}`);
            break;
          }
          page = data.data?.location?.inventoryLevels;
          break;
        } catch (err) {
          if (attempt === 3) {
            errors.push(`location(${lc.locationName}) levels query crashed: ${err.message}`);
          } else {
            await sleep(1500 * (attempt + 1));
          }
        }
      }
      if (!page) break;

      for (const edge of page.edges) {
        const productId = edge.node.item?.variant?.product?.id;
        if (!productId) continue;
        const avail = edge.node.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
        let perLoc = productTotals.get(productId);
        if (!perLoc) {
          // Product appeared in inventory but wasn't in phase 0 (race or new
          // product mid-sync). Initialize it on the fly.
          perLoc = new Map();
          for (const k of trackedKeys) perLoc.set(k, 0);
          productTotals.set(productId, perLoc);
        }
        perLoc.set(key, (perLoc.get(key) || 0) + avail);
      }

      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
      await reportProgress();
    }
  }

  // --- Phase 2: write metafields, batched ----------------------------------
  if (await isStopped()) return { productsScanned: productTotals.size, metafieldsWritten, errors, stopped: true };

  const allEntries = [];
  for (const [productId, perLoc] of productTotals) {
    for (const [key, total] of perLoc) {
      allEntries.push({
        ownerId: productId,
        namespace: "custom",
        key,
        type: "number_integer",
        value: String(total),
      });
    }
  }

  for (let i = 0; i < allEntries.length; i += 25) {
    if (await isStopped()) return { productsScanned: productTotals.size, metafieldsWritten, errors, stopped: true };
    const chunk = allEntries.slice(i, i + 25);
    let chunkOk = false;
    for (let attempt = 0; attempt < 4 && !chunkOk; attempt += 1) {
      try {
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
        const throttled = setData.errors?.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        const errs = setData.data?.metafieldsSet?.userErrors || [];
        if (errs.length > 0) {
          errors.push(`metafieldsSet chunk: ${errs.map((e) => e.message).join(", ")}`);
          break;
        }
        metafieldsWritten += chunk.length;
        chunkOk = true;
      } catch (err) {
        if (attempt === 3) {
          errors.push(`metafieldsSet crashed: ${err.message}`);
        } else {
          await sleep(1500 * (attempt + 1));
        }
      }
    }
    await reportProgress();
  }

  return { productsScanned: productTotals.size, metafieldsWritten, errors };
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
                  conditionObject {
                    ... on CollectionRuleMetafieldCondition {
                      metafieldDefinition { id }
                    }
                  }
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
 * Fetch a single collection's ruleSet with conditionObject populated.
 * Used right before append to avoid race-stale data.
 */
export async function fetchCollectionRuleSet(admin, collectionId) {
  const response = await admin.graphql(
    `#graphql
    query GetCollectionRuleSet($id: ID!) {
      collection(id: $id) {
        id
        title
        ... on Collection {
          ruleSet {
            appliedDisjunctively
            rules {
              column
              relation
              condition
              conditionObject {
                ... on CollectionRuleMetafieldCondition {
                  metafieldDefinition { id }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: collectionId } }
  );
  const data = await response.json();
  return data.data?.collection || null;
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
