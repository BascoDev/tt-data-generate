import { useState, useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchLocations,
  fetchSmartCollections,
  fetchCollectionRuleSet,
  buildCollectionRules,
  updateCollectionRules,
  ensureLocationMetafieldDefinition,
  deleteLocationMetafieldDefinition,
  sanitizeLocationName,
  fullInventorySync,
  fetchProductsCount,
} from "../utils/location-stock.server";
import { unauthenticated } from "../shopify.server";
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

    const inventoryJob = await prisma.inventorySyncJob.findFirst({
      where: { shop },
      orderBy: { startedAt: "desc" },
    });

    return { locationConfigs, collections: [], savedConfigs, shop, inventoryJob, error: null };
  } catch (error) {
    console.error("[SmartCollection Loader] Error:", error);
    return {
      locationConfigs: [],
      collections: [],
      savedConfigs: [],
      shop,
      inventoryJob: null,
      error: error.message,
    };
  }
};

export default function SmartCollectionPage() {
  const { locationConfigs, savedConfigs, shop, inventoryJob: initialJob, error: loaderError } = useLoaderData();
  const fetcher = useFetcher();
  const inventoryFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [message, setMessage] = useState(loaderError || "");
  const [syncResult, setSyncResult] = useState(null);
  const [localCollections, setLocalCollections] = useState([]);
  const [saveError, setSaveError] = useState("");
  const [inventoryJob, setInventoryJob] = useState(initialJob || null);

  const [selectedCollections, setSelectedCollections] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [logicType, setLogicType] = useState("AND");
  const [threshold, setThreshold] = useState(1);

  const activeLocations = locationConfigs.filter((loc) => loc.isActive);

  const isSubmitting = fetcher.state === "submitting";
  const currentAction = fetcher.formData?.get("action");

  const isJobRunning = inventoryJob?.status === "running";

  // Poll job status every 2s while running.
  useEffect(() => {
    if (!isJobRunning) return;
    const tick = () => {
      inventoryFetcher.submit(
        { action: "getInventorySyncStatus", shop },
        { method: "POST" }
      );
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [isJobRunning, shop]);

  useEffect(() => {
    if (inventoryFetcher.data?.success && inventoryFetcher.data.job) {
      setInventoryJob(inventoryFetcher.data.job);
    }
    if (inventoryFetcher.data?.success && inventoryFetcher.data.jobStarted) {
      // Force an immediate status fetch to start polling loop with fresh row.
      inventoryFetcher.submit(
        { action: "getInventorySyncStatus", shop },
        { method: "POST" }
      );
    }
    if (inventoryFetcher.data?.success && inventoryFetcher.data.cancelled) {
      inventoryFetcher.submit(
        { action: "getInventorySyncStatus", shop },
        { method: "POST" }
      );
    }
  }, [inventoryFetcher.data]);

  const handleStartInventorySync = () => {
    inventoryFetcher.submit(
      { action: "startInventorySync", shop },
      { method: "POST" }
    );
  };

  const handleCancelInventorySync = () => {
    if (confirm("Cancel the running inventory sync?")) {
      inventoryFetcher.submit(
        { action: "cancelInventorySync", shop },
        { method: "POST" }
      );
    }
  };

  const inventoryProgressPct = inventoryJob && inventoryJob.totalProducts > 0
    ? Math.min(100, Math.round((inventoryJob.processedProducts / inventoryJob.totalProducts) * 100))
    : 0;

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data?.synced) {
        setSyncResult({
          added: fetcher.data.added || [],
          removed: fetcher.data.removed || [],
        });
        setMessage(`Locations synced: ${fetcher.data.added?.length || 0} added, ${fetcher.data.removed?.length || 0} removed. Click "Start Inventory Sync" below to backfill stock values.`);
        setTimeout(() => setMessage(""), 10000);
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

      {/* Tutorial / How it works */}
      <s-section heading="How it works">
        <s-stack direction="block" gap="small">
          <s-text>
            This tool maintains per-location stock metafields on every product, then appends those metafields as rules to your existing smart collections.
          </s-text>
          <s-stack direction="block" gap="extra-tight">
            <s-text fontWeight="bold" fontSize="small">Step 1 — Sync Locations</s-text>
            <s-text color="subdued" fontSize="small">
              Click <s-text fontWeight="bold">Sync Locations</s-text> to create a metafield definition per location. Run again whenever you add/remove a location in Shopify.
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-tight">
            <s-text fontWeight="bold" fontSize="small">Step 2 — Inventory Sync</s-text>
            <s-text color="subdued" fontSize="small">
              Click <s-text fontWeight="bold">Start Inventory Sync</s-text> to walk every product and write current per-location stock into the metafields. Runs in the background — you can leave the page; progress persists. Run after Step 1 and any time you suspect drift.
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-tight">
            <s-text fontWeight="bold" fontSize="small">Step 3 — Sync Collections</s-text>
            <s-text color="subdued" fontSize="small">
              Click <s-text fontWeight="bold">Sync Collections</s-text> to load your existing smart collections. This tool only modifies smart collections — it does not create new ones.
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-tight">
            <s-text fontWeight="bold" fontSize="small">Step 4 — Pick collections, locations, logic</s-text>
            <s-text color="subdued" fontSize="small">
              Choose one or more smart collections, the locations whose stock should drive membership, the logic (AND = all locations / OR = any location), and a stock threshold. New rules are <s-text fontWeight="bold">appended</s-text> to existing rules; rules already present for the same location are skipped automatically.
            </s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-tight">
            <s-text fontWeight="bold" fontSize="small">Note on logic compatibility</s-text>
            <s-text color="subdued" fontSize="small">
              A smart collection can only use one logic type at a time. If a collection already has rules using AND, you can only append AND rules to it (and vice versa). Change the logic in Shopify Admin first if needed.
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

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
              Sync location list and create metafield definitions. Inventory values are filled via the Inventory Sync section below.
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

      {/* Inventory Sync (manual, background) */}
      <s-section heading="Inventory Sync">
        <s-stack direction="block" gap="base">
          <s-text color="subdued" fontSize="small">
            Walks every product in the shop and writes current per-location stock into the metafields. Runs in the background — you can leave this page and come back; progress is persisted. The product counter reflects scan progress; the metafields counter reflects writes during the final phase.
          </s-text>

          <s-stack direction="inline" gap="base" alignment="center">
            <s-button
              variant="primary"
              onClick={handleStartInventorySync}
              disabled={isJobRunning || activeLocations.length === 0}
              loading={inventoryFetcher.state === "submitting" && inventoryFetcher.formData?.get("action") === "startInventorySync"}
            >
              Start Inventory Sync
            </s-button>
            {isJobRunning && (
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={handleCancelInventorySync}
                loading={inventoryFetcher.state === "submitting" && inventoryFetcher.formData?.get("action") === "cancelInventorySync"}
              >
                Cancel
              </s-button>
            )}
            {activeLocations.length === 0 && (
              <s-text color="subdued" fontSize="small">Sync locations first.</s-text>
            )}
          </s-stack>

          {inventoryJob && (
            <s-box padding="base" borderRadius="base" borderWidth="base">
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base" alignment="center">
                  <s-badge tone={
                    inventoryJob.status === "running" ? "info"
                    : inventoryJob.status === "completed" ? "success"
                    : inventoryJob.status === "cancelled" ? "warning"
                    : "critical"
                  }>
                    {inventoryJob.status}
                  </s-badge>
                  <s-text fontSize="small">
                    {inventoryJob.processedProducts} / {inventoryJob.totalProducts || "?"} products
                  </s-text>
                  <s-text color="subdued" fontSize="small">
                    {inventoryJob.metafieldsWritten} metafields written
                  </s-text>
                </s-stack>

                {inventoryJob.totalProducts > 0 && (
                  <s-progress-indicator
                    progress={inventoryProgressPct}
                    accessibilityLabel={`Inventory sync ${inventoryProgressPct}%`}
                  />
                )}

                <s-stack direction="inline" gap="base" alignment="center">
                  <s-text color="subdued" fontSize="small">
                    Started: {new Date(inventoryJob.startedAt).toLocaleString()}
                  </s-text>
                  {inventoryJob.completedAt && (
                    <s-text color="subdued" fontSize="small">
                      Finished: {new Date(inventoryJob.completedAt).toLocaleString()}
                    </s-text>
                  )}
                </s-stack>

                {(() => {
                  const errs = (() => {
                    try { return JSON.parse(inventoryJob.errors || "[]"); } catch { return []; }
                  })();
                  if (errs.length === 0) return null;
                  return (
                    <s-box padding="tight" borderRadius="base" background="critical-subdued">
                      <s-text fontWeight="bold" color="critical" fontSize="small">
                        {errs.length} error(s):
                      </s-text>
                      <s-unordered-list>
                        {errs.slice(0, 5).map((e, i) => (
                          <s-list-item key={i}>
                            <s-text fontSize="small">{e}</s-text>
                          </s-list-item>
                        ))}
                      </s-unordered-list>
                      {errs.length > 5 && (
                        <s-text color="subdued" fontSize="small">
                          ...and {errs.length - 5} more
                        </s-text>
                      )}
                    </s-box>
                  );
                })()}
              </s-stack>
            </s-box>
          )}
        </s-stack>
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

      const results = [];
      const errors = [];

      for (const collectionId of collectionIds) {
        const collection = await fetchCollectionRuleSet(admin, collectionId);
        const collectionName = collection?.title || "Unnamed";

        if (!collection?.ruleSet) {
          errors.push(`Collection "${collectionName}" is not a smart collection.`);
          continue;
        }

        const existingRules = collection.ruleSet.rules || [];
        const existingAppliedDisjunctively = collection.ruleSet.appliedDisjunctively ?? false;

        // Enforce logic compatibility against existing rules (any column).
        if (existingRules.length > 0 && existingAppliedDisjunctively !== appliedDisjunctively) {
          errors.push(
            `Collection "${collectionName}" already uses ${existingAppliedDisjunctively ? "OR" : "AND"} logic. Cannot append ${logicType} rules — change the logic in Shopify Admin first or pick a different collection.`
          );
          continue;
        }

        // Reconstruct existing rules with conditionObjectId from conditionObject union.
        // Non-metafield rules pass through unchanged.
        const existingDefIds = new Set();
        const preservedRules = [];
        let collectionFailed = false;
        for (const rule of existingRules) {
          if (rule.column === "PRODUCT_METAFIELD_DEFINITION") {
            const defId = rule.conditionObject?.metafieldDefinition?.id;
            if (!defId) {
              errors.push(
                `Collection "${collectionName}" has a metafield rule referencing a deleted definition. Please remove it in Shopify Admin first.`
              );
              collectionFailed = true;
              break;
            }
            existingDefIds.add(defId);
            preservedRules.push({
              column: rule.column,
              relation: rule.relation,
              condition: rule.condition,
              conditionObjectId: defId,
            });
          } else {
            preservedRules.push({
              column: rule.column,
              relation: rule.relation,
              condition: rule.condition,
            });
          }
        }
        if (collectionFailed) continue;

        // Skip rules whose definition is already present (idempotent append).
        const rulesToAppend = newRules.filter((r) => !existingDefIds.has(r.conditionObjectId));
        const skippedCount = newRules.length - rulesToAppend.length;

        if (rulesToAppend.length === 0) {
          results.push(`Collection "${collectionName}": all ${newRules.length} location rule(s) already present, no change.`);
        } else {
          const mergedRules = [...preservedRules, ...rulesToAppend];
          await updateCollectionRules(admin, collectionId, mergedRules, appliedDisjunctively);
          const skippedNote = skippedCount > 0 ? ` (${skippedCount} already present, skipped)` : "";
          results.push(`Collection "${collectionName}": appended ${rulesToAppend.length} rule(s)${skippedNote}.`);
        }

        // Always create a fresh history row so users see the last 10 saves.
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

      // Inventory backfill is now a separate manual action — see
      // "startInventorySync". Sync Locations only manages metafield definitions
      // and the local locationConfig table.

      return { success: true, synced: true, added, removed };
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

  if (actionType === "startInventorySync") {
    try {
      // Reject if a running job already exists for this shop.
      const existing = await prisma.inventorySyncJob.findFirst({
        where: { shop, status: "running" },
        orderBy: { startedAt: "desc" },
      });
      if (existing) {
        // Stale-job recovery: if a "running" row hasn't been updated for >5min,
        // assume the previous server crashed and mark it failed.
        const stale = Date.now() - new Date(existing.updatedAt).getTime() > 5 * 60 * 1000;
        if (stale) {
          await prisma.inventorySyncJob.update({
            where: { id: existing.id },
            data: {
              status: "failed",
              completedAt: new Date(),
              errors: JSON.stringify([
                ...(JSON.parse(existing.errors || "[]")),
                "Job marked failed after 5 minutes of inactivity (server likely restarted).",
              ]),
            },
          });
        } else {
          return { error: "An inventory sync is already running. Please wait for it to finish.", action: "startInventorySync" };
        }
      }

      const { admin } = await authenticate.admin(request);
      const totalProducts = await fetchProductsCount(admin);

      const job = await prisma.inventorySyncJob.create({
        data: { shop, status: "running", totalProducts },
      });

      // Fire-and-forget background runner. Uses unauthenticated.admin(shop)
      // so it survives past the request lifecycle.
      runInventorySyncJob(job.id, shop).catch(async (err) => {
        try {
          await prisma.inventorySyncJob.update({
            where: { id: job.id },
            data: {
              status: "failed",
              completedAt: new Date(),
              errors: JSON.stringify([`Runner crashed: ${err?.message || String(err)}`]),
            },
          });
        } catch (_) {
          // ignore
        }
      });

      return { success: true, jobStarted: true, jobId: job.id };
    } catch (error) {
      console.error("[SmartCollection Action] startInventorySync error:", error);
      return { error: error.message, action: "startInventorySync" };
    }
  }

  if (actionType === "getInventorySyncStatus") {
    try {
      const job = await prisma.inventorySyncJob.findFirst({
        where: { shop },
        orderBy: { startedAt: "desc" },
      });
      return { success: true, job };
    } catch (error) {
      return { error: error.message };
    }
  }

  if (actionType === "cancelInventorySync") {
    try {
      const job = await prisma.inventorySyncJob.findFirst({
        where: { shop, status: "running" },
        orderBy: { startedAt: "desc" },
      });
      if (job) {
        // Mark as cancelled — runner checks shouldStop() between pages.
        await prisma.inventorySyncJob.update({
          where: { id: job.id },
          data: { status: "cancelled" },
        });
      }
      return { success: true, cancelled: true };
    } catch (error) {
      return { error: error.message };
    }
  }

  return null;
};

/**
 * Background runner for an InventorySyncJob. Polls own status row
 * to detect cancellation, persists progress after every page.
 */
async function runInventorySyncJob(jobId, shop) {
  const { admin } = await unauthenticated.admin(shop);

  const result = await fullInventorySync(admin, shop, {
    onProgress: async ({ productsScanned, metafieldsWritten, errors, cursor }) => {
      await prisma.inventorySyncJob.update({
        where: { id: jobId },
        data: {
          processedProducts: productsScanned,
          metafieldsWritten,
          cursor: cursor || null,
          errors: JSON.stringify(errors || []),
        },
      });
    },
    shouldStop: async () => {
      const row = await prisma.inventorySyncJob.findUnique({ where: { id: jobId } });
      return row?.status === "cancelled";
    },
  });

  // If we got here without being cancelled, mark completed (or failed if errors).
  const current = await prisma.inventorySyncJob.findUnique({ where: { id: jobId } });
  if (current?.status === "cancelled") {
    await prisma.inventorySyncJob.update({
      where: { id: jobId },
      data: {
        completedAt: new Date(),
        processedProducts: result.productsScanned,
        metafieldsWritten: result.metafieldsWritten,
        errors: JSON.stringify(result.errors || []),
      },
    });
    return;
  }

  await prisma.inventorySyncJob.update({
    where: { id: jobId },
    data: {
      status: result.errors?.length > 0 ? "completed" : "completed",
      completedAt: new Date(),
      processedProducts: result.productsScanned,
      metafieldsWritten: result.metafieldsWritten,
      errors: JSON.stringify(result.errors || []),
    },
  });

  await logDebug(
    shop,
    "inventory-sync-job",
    `Job ${jobId} done: ${result.productsScanned} products, ${result.metafieldsWritten} metafields, ${result.errors?.length || 0} errors`
  );
}
