import { useState, useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchLocations,
  fetchSmartCollections,
  buildCollectionRules,
  updateCollectionRules,
  ensureLocationMetafieldDefinition,
  deleteLocationMetafieldDefinition,
  sanitizeLocationName,
  fullInventorySync,
} from "../utils/location-stock.server";
import { logDebug, logError } from "../utils/logger.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const savedConfigs = await prisma.collectionRuleConfig.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const locationConfigs = await prisma.locationConfig.findMany({
      where: { shop },
      orderBy: { createdAt: "asc" },
    });

    return { locationConfigs, collections: [], savedConfigs, shop, error: null };
  } catch (error) {
    console.error("[SmartCollection Loader] Error:", error);
    return {
      locationConfigs: [],
      collections: [],
      savedConfigs: [],
      shop,
      error: error.message,
    };
  }
};

export default function SmartCollectionPage() {
  const { locationConfigs, savedConfigs, shop, error: loaderError } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [message, setMessage] = useState(loaderError || "");
  const [syncResult, setSyncResult] = useState(null);
  const [localCollections, setLocalCollections] = useState([]);
  const [saveError, setSaveError] = useState("");

  const [selectedCollections, setSelectedCollections] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [logicType, setLogicType] = useState("AND");
  const [threshold, setThreshold] = useState(1);

  const activeLocations = locationConfigs.filter((loc) => loc.isActive);

  const isSubmitting = fetcher.state === "submitting";
  const currentAction = fetcher.formData?.get("action");

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data?.synced) {
        setSyncResult({
          added: fetcher.data.added || [],
          removed: fetcher.data.removed || [],
        });
        const inv = fetcher.data.inventorySync;
        const invMsg = inv
          ? ` Inventory backfilled for ${inv.productsScanned} products (${inv.metafieldsWritten} metafields written).`
          : "";
        setMessage(`Locations synced: ${fetcher.data.added?.length || 0} added, ${fetcher.data.removed?.length || 0} removed.${invMsg}`);
        setTimeout(() => setMessage(""), 8000);
      } else if (fetcher.data?.syncedCollections) {
        setLocalCollections(fetcher.data.collections || []);
        setMessage(`Collections synced: ${fetcher.data.collections?.length || 0} smart collections loaded.`);
        setTimeout(() => setMessage(""), 8000);
      } else if (fetcher.data?.deleted) {
        setMessage("Deleted successfully.");
        setTimeout(() => setMessage(""), 8000);
      } else {
        const results = fetcher.data.results || [];
        setSaveError("");
        setMessage(results.join(" ") || "Configuration saved successfully!");
        setSelectedCollections([]);
        setSelectedLocations([]);
        setLogicType("AND");
        setThreshold(1);
        revalidator.revalidate();
        setTimeout(() => setMessage(""), 8000);
      }
    } else if (fetcher.data?.error) {
      if (fetcher.data?.action === "save") {
        setSaveError(fetcher.data.error);
      } else {
        setMessage(`Error: ${fetcher.data.error}`);
        setTimeout(() => setMessage(""), 8000);
      }
    }
  }, [fetcher.data]);

  const handleCollectionToggle = (collectionId) => {
    setSelectedCollections((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId]
    );
  };

  const handleLocationToggle = (locationId) => {
    setSelectedLocations((prev) =>
      prev.includes(locationId)
        ? prev.filter((id) => id !== locationId)
        : [...prev, locationId]
    );
  };

  const handleSelectAllCollections = () => {
    if (selectedCollections.length === localCollections.length) {
      setSelectedCollections([]);
    } else {
      setSelectedCollections(localCollections.map((c) => c.id));
    }
  };

  const handleSelectAllLocations = () => {
    if (selectedLocations.length === activeLocations.length) {
      setSelectedLocations([]);
    } else {
      setSelectedLocations(activeLocations.map((l) => l.locationId));
    }
  };

  const handleSubmit = () => {
    setSaveError("");
    if (selectedCollections.length === 0) {
      setSaveError("Please select at least one collection.");
      return;
    }
    if (selectedLocations.length === 0) {
      setSaveError("Please select at least one location.");
      return;
    }

    fetcher.submit(
      {
        action: "save",
        collectionIds: JSON.stringify(selectedCollections),
        locationIds: JSON.stringify(selectedLocations),
        logicType,
        threshold: String(threshold),
        shop,
      },
      { method: "POST" }
    );
  };

  const handleSyncLocations = () => {
    setSyncResult(null);
    fetcher.submit(
      { action: "syncLocations", shop },
      { method: "POST" }
    );
  };

  const handleSyncCollections = () => {
    setSyncResult(null);
    fetcher.submit(
      { action: "syncCollections", shop },
      { method: "POST" }
    );
  };

  const handleDeleteLocation = (locationConfigId, locationName) => {
    if (confirm(`Delete location "${locationName}" and its metafield config?`)) {
      fetcher.submit(
        { action: "deleteLocation", locationConfigId, shop },
        { method: "POST" }
      );
    }
  };

  return (
    <s-page heading="Smart Collection (Location Stock)">
      {message && (
        <s-box padding="base" borderRadius="base" background={message.includes("Error") ? "critical-subdued" : "success-subdued"}>
          <s-text color={message.includes("Error") ? "critical" : "success"} fontWeight="bold">
            {message}
          </s-text>
        </s-box>
      )}

      {/* Shop Locations */}
      <s-section heading="Shop Locations">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignment="center">
            <s-button
              variant="primary"
              onClick={handleSyncLocations}
              loading={isSubmitting && currentAction === "syncLocations"}
            >
              Sync Locations
            </s-button>
            <s-text color="subdued" fontSize="small">
              Sync all locations and backfill inventory metafields.
            </s-text>
          </s-stack>

          {activeLocations.length === 0 ? (
            <s-text color="subdued">No locations found. Click &quot;Sync Locations&quot; to load.</s-text>
          ) : (
            <s-stack direction="block" gap="small">
              {activeLocations.map((loc) => (
                <s-box
                  key={loc.locationId}
                  padding="tight"
                  borderWidth="base"
                  borderRadius="base"
                  borderColor={loc.metafieldDefinitionId ? "success" : "warning"}
                >
                  <s-stack direction="inline" gap="small" alignment="center">
                    <s-badge tone={loc.metafieldDefinitionId ? "success" : "warning"} size="small">
                      {loc.metafieldDefinitionId ? "Ready" : "Pending"}
                    </s-badge>
                    <s-text fontSize="small">{loc.locationName}</s-text>
                    <s-text color="subdued" fontSize="small">
                      custom.{loc.metafieldKey || `loc_${loc.locationId}`}
                    </s-text>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      size="micro"
                      onClick={() => handleDeleteLocation(loc.id, loc.locationName)}
                      loading={isSubmitting && currentAction === "deleteLocation"}
                    >
                      Delete
                    </s-button>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-stack>

        {syncResult?.added?.length > 0 && (
          <s-box padding="base" borderRadius="base" background="success-subdued" marginTop="base">
            <s-text fontWeight="bold" color="success">New Locations Added:</s-text>
            <s-unordered-list>
              {syncResult.added.map((loc) => (
                <s-list-item key={loc.locationId}>{loc.locationName}</s-list-item>
              ))}
            </s-unordered-list>
          </s-box>
        )}

        {syncResult?.removed?.length > 0 && (
          <s-box padding="base" borderRadius="base" background="critical-subdued" marginTop="base">
            <s-text fontWeight="bold" color="critical">Removed Locations:</s-text>
            <s-unordered-list>
              {syncResult.removed.map((loc) => (
                <s-list-item key={loc.locationId}>
                  {loc.locationName} (custom.{loc.metafieldKey || `loc_${loc.locationId}`})
                </s-list-item>
              ))}
            </s-unordered-list>
          </s-box>
        )}
      </s-section>

      {/* Create Collection Rule */}
      <s-section heading="Create Collection Rule">
        <s-stack direction="block" gap="large">

          {/* Collections */}
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base" alignment="center">
              <s-text fontWeight="bold">Collections</s-text>
              <s-button variant="secondary" size="slim" onClick={handleSyncCollections} loading={isSubmitting && currentAction === "syncCollections"}>
                Sync Collections
              </s-button>
              <s-button variant="tertiary" size="slim" onClick={handleSelectAllCollections}>
                {selectedCollections.length === localCollections.length && localCollections.length > 0 ? "Deselect All" : "Select All"}
              </s-button>
            </s-stack>
            <s-text color="subdued" fontSize="small">
              {selectedCollections.length} of {localCollections.length} selected
            </s-text>

            {localCollections.length === 0 ? (
              <s-text color="subdued">No collections found. Click &quot;Sync Collections&quot; to load.</s-text>
            ) : (
              <s-stack direction="inline" gap="small" wrap="true">
                {localCollections.map((col) => (
                  <s-button
                    key={col.id}
                    variant={selectedCollections.includes(col.id) ? "primary" : "secondary"}
                    size="slim"
                    onClick={() => handleCollectionToggle(col.id)}
                  >
                    {col.title}
                  </s-button>
                ))}
              </s-stack>
            )}
          </s-stack>

          {/* Locations */}
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base" alignment="center">
              <s-text fontWeight="bold">Locations</s-text>
              <s-button variant="tertiary" size="slim" onClick={handleSelectAllLocations}>
                {selectedLocations.length === activeLocations.length && activeLocations.length > 0 ? "Deselect All" : "Select All"}
              </s-button>
            </s-stack>
            <s-text color="subdued" fontSize="small">
              {selectedLocations.length} of {activeLocations.length} selected
            </s-text>

            {activeLocations.length === 0 ? (
              <s-text color="subdued">No active locations. Please sync locations first.</s-text>
            ) : (
              <s-stack direction="block" gap="small">
                {activeLocations.map((loc) => (
                  <s-button
                    key={loc.locationId}
                    variant={selectedLocations.includes(loc.locationId) ? "primary" : "secondary"}
                    size="slim"
                    onClick={() => handleLocationToggle(loc.locationId)}
                  >
                    {loc.locationName}
                  </s-button>
                ))}
              </s-stack>
            )}
          </s-stack>

          {/* Logic & Threshold */}
          <s-stack direction="inline" gap="large" alignment="start">
            <s-stack direction="block" gap="small">
              <s-text fontWeight="bold">Logic Type</s-text>
              <s-stack direction="inline" gap="base">
                <s-button
                  variant={logicType === "AND" ? "primary" : "secondary"}
                  size="slim"
                  onClick={() => setLogicType("AND")}
                >
                  AND
                </s-button>
                <s-button
                  variant={logicType === "OR" ? "primary" : "secondary"}
                  size="slim"
                  onClick={() => setLogicType("OR")}
                >
                  OR
                </s-button>
              </s-stack>
              <s-text color="subdued" fontSize="small">
                {logicType === "AND"
                  ? "Product must have stock in ALL selected locations."
                  : "Product must have stock in ANY of the selected locations."}
              </s-text>
            </s-stack>

            <s-stack direction="block" gap="small">
              <s-text fontWeight="bold">Stock Threshold</s-text>
              <s-text-field
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value) || 0))}
                helpText="Min available stock to include"
                min={0}
              />
            </s-stack>
          </s-stack>

          {/* Save */}
          <s-stack direction="block" gap="small">
            <s-button
              variant="primary"
              onClick={handleSubmit}
              loading={isSubmitting && currentAction === "save"}
            >
              Save Configuration
            </s-button>
            {saveError && (
              <s-text color="critical" fontSize="small">
                {saveError}
              </s-text>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      {/* Saved Configurations */}
      <s-section heading="Saved Configurations">
        {savedConfigs.length === 0 ? (
          <s-text color="subdued">No configurations yet.</s-text>
        ) : (
          <s-stack direction="block" gap="small">
            {savedConfigs.map((config) => {
              const locIds = JSON.parse(config.locationIds || "[]");
              const locNames = activeLocations
                .filter((l) => locIds.includes(l.locationId))
                .map((l) => l.locationName)
                .join(", ");
              return (
                <s-box
                  key={config.id}
                  padding="tight"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="inline" gap="base" alignment="center" wrap="true">
                    <s-text fontWeight="bold" fontSize="small">{config.collectionName}</s-text>
                    <s-badge tone={config.logicType === "AND" ? "info" : "warning"} size="small">
                      {config.logicType}
                    </s-badge>
                    <s-badge tone={config.isActive ? "success" : "critical"} size="small">
                      {config.isActive ? "Active" : "Inactive"}
                    </s-badge>
                    <s-text color="subdued" fontSize="small">
                      Threshold: {config.threshold}
                    </s-text>
                    <s-text color="subdued" fontSize="small">
                      Locations: {locNames || "Unknown"}
                    </s-text>
                    <s-text color="subdued" fontSize="small">
                      {new Date(config.createdAt).toLocaleString()}
                    </s-text>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const createdBy = session.email || "Unknown";

  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "save") {
    try {
      const collectionIds = JSON.parse(formData.get("collectionIds") || "[]");
      const locationIds = JSON.parse(formData.get("locationIds") || "[]");
      const logicType = formData.get("logicType") || "AND";
      const threshold = parseInt(formData.get("threshold") || "1", 10);

      if (collectionIds.length === 0) {
        return { error: "Please select at least one collection.", action: "save" };
      }
      if (locationIds.length === 0) {
        return { error: "Please select at least one location.", action: "save" };
      }

      const { admin } = await authenticate.admin(request);

      const locationConfigs = await prisma.locationConfig.findMany({
        where: {
          shop,
          locationId: { in: locationIds },
        },
      });

      for (const config of locationConfigs) {
        if (!config.metafieldDefinitionId) {
          return { error: `Location ${config.locationName} does not have a metafield definition yet. Please sync locations first.`, action: "save" };
        }
        if (!String(config.metafieldDefinitionId).startsWith("gid://")) {
          return { error: `Location ${config.locationName} has an invalid metafield definition ID (${config.metafieldDefinitionId}). Please re-sync locations.`, action: "save" };
        }
      }

      const appliedDisjunctively = logicType === "OR";
      const newRules = buildCollectionRules(locationConfigs, threshold);

      console.log("[Save] Selected locationConfigs:", JSON.stringify(locationConfigs.map((l) => ({ name: l.locationName, defId: l.metafieldDefinitionId }))));
      console.log("[Save] Built newRules:", JSON.stringify(newRules));

      const results = [];
      const errors = [];

      for (const collectionId of collectionIds) {
        const collectionResponse = await admin.graphql(
          `#graphql
          query GetCollection($id: ID!) {
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
                  }
                }
              }
            }
          }`,
          { variables: { id: collectionId } }
        );
        const collectionData = await collectionResponse.json();
        const collection = collectionData.data?.collection;
        const collectionName = collection?.title || "Unnamed";

        if (!collection?.ruleSet) {
          errors.push(`Collection "${collectionName}" is not a smart collection.`);
          continue;
        }

        const existingRules = collection.ruleSet.rules || [];
        const existingAppliedDisjunctively = collection.ruleSet.appliedDisjunctively ?? false;

        if (existingRules.length > 0 && existingAppliedDisjunctively !== appliedDisjunctively) {
          errors.push(
            `Collection "${collectionName}" already uses ${existingAppliedDisjunctively ? "OR" : "AND"} logic. Cannot append ${logicType} rules.`
          );
          continue;
        }

        // Enrich existing PRODUCT_METAFIELD_DEFINITION rules with conditionObjectId
        // because Shopify query does not return it, but collectionUpdate requires it.
        const enrichedExistingRules = existingRules.map((rule) => ({ ...rule }));
        const existingMetafieldRules = enrichedExistingRules.filter(
          (r) => r.column === "PRODUCT_METAFIELD_DEFINITION"
        );

        if (existingMetafieldRules.length > 0) {
          const historyConfig = await prisma.collectionRuleConfig.findFirst({
            where: { shop, collectionId },
          });

          let knownDefIds = [];
          if (historyConfig) {
            const histLocIds = JSON.parse(historyConfig.locationIds || "[]");
            const histLocations = await prisma.locationConfig.findMany({
              where: { shop, locationId: { in: histLocIds } },
            });
            knownDefIds = histLocations
              .map((l) => l.metafieldDefinitionId)
              .filter((id) => id && String(id).startsWith("gid://"));
          }

          const allKnownDefIds = [...new Set([...knownDefIds])];

          for (let i = 0; i < existingMetafieldRules.length; i++) {
            if (allKnownDefIds[i]) {
              existingMetafieldRules[i].conditionObjectId = allKnownDefIds[i];
            } else {
              errors.push(
                `Collection "${collectionName}" has existing metafield rules with unknown definitions. Please remove them in Shopify Admin before adding new rules.`
              );
              break;
            }
          }
          if (errors.length > 0) continue;
        }

        const mergedRules = [...enrichedExistingRules, ...newRules];
        console.log(`[Save] Collection "${collectionName}" mergedRules:`, JSON.stringify(mergedRules));

        await updateCollectionRules(admin, collectionId, mergedRules, appliedDisjunctively);
        results.push(`Collection "${collectionName}": appended ${newRules.length} rule(s).`);

        const existingConfig = await prisma.collectionRuleConfig.findFirst({
          where: { shop, collectionId },
        });

        if (existingConfig) {
          await prisma.collectionRuleConfig.update({
            where: { id: existingConfig.id },
            data: {
              collectionName,
              logicType,
              threshold,
              locationIds: JSON.stringify(locationIds),
              isActive: true,
              createdBy,
            },
          });
        } else {
          await prisma.collectionRuleConfig.create({
            data: {
              shop,
              collectionId,
              collectionName,
              logicType,
              threshold,
              locationIds: JSON.stringify(locationIds),
              isActive: true,
              createdBy,
            },
          });
        }
      }

      if (errors.length > 0) {
        return { error: errors.join(" "), action: "save" };
      }

      // Keep only the latest 10 configs for this shop
      const allConfigs = await prisma.collectionRuleConfig.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (allConfigs.length > 10) {
        const idsToDelete = allConfigs.slice(10).map((c) => c.id);
        await prisma.collectionRuleConfig.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      return { success: true, results };
    } catch (error) {
      console.error("[SmartCollection Action] Error:", error);
      return { error: error.message, action: "save" };
    }
  }

  if (actionType === "syncLocations") {
    try {
      const { admin } = await authenticate.admin(request);

      const shopifyLocations = await fetchLocations(admin);
      const localConfigs = await prisma.locationConfig.findMany({
        where: { shop },
      });

      const shopifyLocationIds = new Set(shopifyLocations.map((l) => l.id.replace("gid://shopify/Location/", "")));
      const localLocationIds = new Set(localConfigs.map((c) => c.locationId));

      const added = [];
      const removed = [];

      for (const location of shopifyLocations) {
        const locationId = location.id.replace("gid://shopify/Location/", "");
        if (!localLocationIds.has(locationId)) {
          let metafieldDefinitionId = null;
          try {
            metafieldDefinitionId = await ensureLocationMetafieldDefinition(admin, locationId, location.name);
          } catch (err) {
            await logError(shop, "smart-collection-sync", `Failed to create metafield definition for ${locationId}: ${err.message}`);
          }

          await prisma.locationConfig.create({
            data: {
              shop,
              locationId,
              locationName: location.name,
              metafieldKey: sanitizeLocationName(location.name) || undefined,
              metafieldDefinitionId,
            },
          });

          added.push({ locationId, locationName: location.name });
          await logDebug(shop, "smart-collection-sync", `Added location: ${location.name}`, { locationId });
        } else {
          const existingConfig = localConfigs.find((c) => c.locationId === locationId);
          const newMetafieldKey = sanitizeLocationName(location.name) || undefined;
          if (existingConfig && !existingConfig.metafieldKey && newMetafieldKey) {
            await prisma.locationConfig.update({
              where: { id: existingConfig.id },
              data: { metafieldKey: newMetafieldKey },
            });
          }
        }
      }

      for (const config of localConfigs) {
        if (!shopifyLocationIds.has(config.locationId) && config.isActive) {
          if (config.metafieldDefinitionId) {
            try {
              await deleteLocationMetafieldDefinition(admin, config.metafieldDefinitionId);
            } catch (err) {
              await logError(shop, "smart-collection-sync", `Failed to delete metafield definition for ${config.locationName}: ${err.message}`);
            }
          }

          await prisma.locationConfig.delete({
            where: { id: config.id },
          });

          removed.push({ locationId: config.locationId, locationName: config.locationName });
          await logDebug(shop, "smart-collection-sync", `Removed location config: ${config.locationName}`, { locationId: config.locationId });
        }
      }

      let inventorySync = null;
      try {
        inventorySync = await fullInventorySync(admin, shop);
        await logDebug(shop, "smart-collection-sync", `Inventory backfill: scanned=${inventorySync.productsScanned}, metafields=${inventorySync.metafieldsWritten}`);
      } catch (err) {
        await logError(shop, "smart-collection-sync", `Inventory backfill failed: ${err.message}`);
      }

      return { success: true, synced: true, added, removed, inventorySync };
    } catch (error) {
      console.error("[SmartCollection Action] Sync error:", error);
      return { error: error.message };
    }
  }

  if (actionType === "syncCollections") {
    try {
      const { admin } = await authenticate.admin(request);
      const collections = await fetchSmartCollections(admin);
      return { success: true, syncedCollections: true, collections };
    } catch (error) {
      console.error("[SmartCollection Action] Sync collections error:", error);
      return { error: error.message };
    }
  }

  if (actionType === "deleteLocation") {
    try {
      const locationConfigId = formData.get("locationConfigId");
      const config = await prisma.locationConfig.findUnique({
        where: { id: locationConfigId },
      });

      if (config) {
        if (config.metafieldDefinitionId) {
          try {
            const { admin } = await authenticate.admin(request);
            await deleteLocationMetafieldDefinition(admin, config.metafieldDefinitionId);
          } catch (err) {
            await logError(shop, "smart-collection-delete", `Failed to delete metafield definition for ${config.locationName}: ${err.message}`);
          }
        }

        await prisma.locationConfig.delete({
          where: { id: locationConfigId },
        });
        await logDebug(shop, "smart-collection-delete", `Deleted location config: ${config.locationName}`, { locationId: config.locationId });
      }

      return { success: true, deleted: true };
    } catch (error) {
      console.error("[SmartCollection Action] Delete location error:", error);
      return { error: error.message };
    }
  }

  return null;
};
