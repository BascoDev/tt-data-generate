import { useState, useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const APP_VERSION = "v1.1.0";
const UPDATE_DETAILS = "Fixed bug in product duplicate."

// SKU Generation Utility Functions
function generateNumericSKU(prefix, length, useSeparator) {
  const randomNum = Math.floor(Math.pow(10, length - 1) + Math.random() * (Math.pow(10, length) - Math.pow(10, length - 1)));
  const separator = useSeparator ? "-" : "";
  return `${prefix}${separator}${randomNum.toString().padStart(length, '0')}`;
}

function generateAlphanumericSKU(prefix, length, useSeparator) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const separator = useSeparator ? "-" : "";
  return `${prefix}${separator}${result}`;
}

function generateSKU(settings) {
  if (settings.skuType === "numeric") {
    return generateNumericSKU(settings.skuPrefix, settings.skuLength, settings.useSeparator);
  } else {
    return generateAlphanumericSKU(settings.skuPrefix, settings.skuLength, settings.useSeparator);
  }
}

// Default settings
const DEFAULT_SETTINGS = {
  skuPrefix: "TT",
  skuLength: 8,
  skuType: "numeric",
  useSeparator: true,
  autoGenerateForProducts: true,
  autoGenerateForVariants: true,
  onlyWhenEmpty: true,
  isActive: true,
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Load settings from database for this shop
    let settings = await prisma.shopSettings.findUnique({
      where: { shop }
    });

    // If no settings exist, create default for this shop
    if (!settings) {
      settings = await prisma.shopSettings.create({
        data: {
          shop,
          ...DEFAULT_SETTINGS
        }
      });
    }

    return { settings, shop, error: null };
  } catch (error) {
    console.error("[Settings Loader] Database error:", error);
    return {
      settings: DEFAULT_SETTINGS,
      shop,
      error: `Database error: ${error.message}. Please ensure database is configured correctly.`
    };
  }
};

export default function SettingsPage() {
  const { settings: loadedSettings, shop, error: loaderError } = useLoaderData();
  const fetcher = useFetcher();
  const [settings, setSettings] = useState(loadedSettings || DEFAULT_SETTINGS);
  const [previewSKU, setPreviewSKU] = useState("");
  const [saveMessage, setSaveMessage] = useState(loaderError || "");

  useEffect(() => {
    if (fetcher.data?.success) {
      setSaveMessage("Settings saved successfully!");
      setTimeout(() => setSaveMessage(""), 3000);
    } else if (fetcher.data?.error) {
      setSaveMessage(`Error: ${fetcher.data.error}`);
    }
  }, [fetcher.data]);

  const handleGeneratePreview = () => {
    const sku = generateSKU(settings);
    setPreviewSKU(sku);
  };

  const handleSave = () => {
    fetcher.submit(
      {
        action: "save",
        settings: JSON.stringify(settings),
        shop
      },
      { method: "POST" }
    );
  };

  return (
    <s-page heading="Settings">
      {/* Shop Info */}
      <s-section heading="Shop Information">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignment="center">
            <s-text fontWeight="bold">Shop:</s-text>
            <s-text>{shop}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" alignment="center">
            <s-text fontWeight="bold">App Version:</s-text>
            <s-text as="code">{APP_VERSION}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" alignment="center">
            <s-text fontWeight="bold">Update Details:</s-text>
            <s-text as="code">{UPDATE_DETAILS}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" alignment="center">
            <s-badge tone={settings.isActive ? "success" : "warning"}>
              {settings.isActive ? "Active" : "Paused"}
            </s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      {/* SKU Configuration */}
      <s-section heading="SKU Configuration">
        <s-stack direction="block" gap="base">
          {/* Prefix */}
          <s-text-field
            label="SKU Prefix"
            value={settings.skuPrefix}
            onChange={(e) => {
              setSettings({ ...settings, skuPrefix: e.target.value.toUpperCase() });
              setPreviewSKU("");
            }}
            helpText="The prefix for all generated SKUs (e.g., TT, PROD, ITEM)"
            maxLength={10}
          />

          {/* Length */}
          <s-text-field
            label="SKU Length"
            type="number"
            value={settings.skuLength}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 4;
              setSettings({ ...settings, skuLength: Math.min(Math.max(value, 4), 16) });
              setPreviewSKU("");
            }}
            helpText="Number of characters after prefix (4-16, default: 8)"
            min={4}
            max={16}
          />

          {/* Type */}
          <s-stack direction="block" gap="small">
            <s-text fontWeight="bold">SKU Type</s-text>
            <s-stack direction="inline" gap="base">
              <s-radio-button
                name="skuType"
                value="numeric"
                checked={settings.skuType === "numeric"}
                onChange={() => {
                  setSettings({ ...settings, skuType: "numeric" });
                  setPreviewSKU("");
                }}
              >
                Numeric Only (0-9)
              </s-radio-button>
              <s-radio-button
                name="skuType"
                value="alphanumeric"
                checked={settings.skuType === "alphanumeric"}
                onChange={() => {
                  setSettings({ ...settings, skuType: "alphanumeric" });
                  setPreviewSKU("");
                }}
              >
                Alphanumeric (A-Z, 0-9)
              </s-radio-button>
            </s-stack>
          </s-stack>

          {/* Separator Toggle */}
          <s-checkbox
            label="Use separator (-) between prefix and SKU"
            checked={settings.useSeparator}
            onChange={(e) => {
              setSettings({ ...settings, useSeparator: e.target.checked });
              setPreviewSKU("");
            }}
            helpText="Example: TT-12345678 (with separator) vs TT12345678 (without)"
          />

          {/* Preview */}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text fontWeight="bold">Preview</s-text>
              <s-stack direction="inline" gap="base" alignment="center">
                <s-text as="code" fontSize="large">
                  {previewSKU || "Click generate to preview"}
                </s-text>
                <s-button variant="tertiary" onClick={handleGeneratePreview}>
                  Generate Preview
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Auto-Generation Settings */}
      <s-section heading="Auto-Generation Settings">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Enable SKU Generator for this shop"
            checked={settings.isActive}
            onChange={(e) => setSettings({ ...settings, isActive: e.target.checked })}
            helpText="When disabled, no SKUs will be generated for this shop"
          />
          <s-checkbox
            label="Auto-generate SKU for new products"
            checked={settings.autoGenerateForProducts}
            onChange={(e) => setSettings({ ...settings, autoGenerateForProducts: e.target.checked })}
            disabled={!settings.isActive}
          />
          <s-checkbox
            label="Auto-generate SKU for new variants"
            checked={settings.autoGenerateForVariants}
            onChange={(e) => setSettings({ ...settings, autoGenerateForVariants: e.target.checked })}
            disabled={!settings.isActive}
          />
          <s-checkbox
            label="Only generate when SKU field is empty"
            checked={settings.onlyWhenEmpty}
            onChange={(e) => setSettings({ ...settings, onlyWhenEmpty: e.target.checked })}
            helpText="If unchecked, existing SKUs will be overwritten"
          />
        </s-stack>
      </s-section>

      {/* Save Button */}
      <s-section>
        <s-stack direction="inline" gap="base" alignment="center">
          <s-button
            variant="primary"
            onClick={handleSave}
            loading={fetcher.state === "submitting"}
          >
            Save Settings
          </s-button>
          {saveMessage && (
            <s-text color={saveMessage.includes("Error") ? "critical" : "success"} fontWeight="bold">
              {saveMessage}
            </s-text>
          )}
        </s-stack>
      </s-section>

      {/* Features */}
      <s-section heading="Features" slot="aside">
        <s-unordered-list>
          <s-list-item>
            <strong>Multi-tenant</strong> - Each shop has independent settings
          </s-list-item>
          <s-list-item>
            <strong>Webhook Listening</strong> - Listen to product/variant creation events
          </s-list-item>
          <s-list-item>
            <strong>Auto SKU Generation</strong> - Automatically generate SKUs
          </s-list-item>
          <s-list-item>
            <strong>Customizable Format</strong> - Configure prefix, length, and type
          </s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Permissions */}
      <s-section heading="Permissions" slot="aside">
        <s-unordered-list>
          <s-list-item>read_products / write_products</s-list-item>
          <s-list-item>read_inventory / write_inventory</s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Support */}
      <s-section heading="Support" slot="aside">
        <s-paragraph>
          For help, please visit{" "}
          <s-link href="https://shopify.dev/docs/apps" target="_blank">
            Shopify Developer Docs
          </s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "save") {
    try {
      const settings = JSON.parse(formData.get("settings"));

      // Save to database for this shop
      await prisma.shopSettings.upsert({
        where: { shop },
        update: {
          skuPrefix: settings.skuPrefix,
          skuLength: settings.skuLength,
          skuType: settings.skuType,
          useSeparator: settings.useSeparator,
          autoGenerateForProducts: settings.autoGenerateForProducts,
          autoGenerateForVariants: settings.autoGenerateForVariants,
          onlyWhenEmpty: settings.onlyWhenEmpty,
          isActive: settings.isActive,
        },
        create: {
          shop,
          ...settings
        }
      });

      return { success: true };
    } catch (error) {
      console.error("Error saving settings:", error);
      return { error: error.message };
    }
  }

  return null;
};
