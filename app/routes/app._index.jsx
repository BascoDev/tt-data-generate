import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Auto-register webhooks on app load
  try {
    await registerWebhooks({ session });
    console.log("[App] Webhooks registered successfully");
  } catch (error) {
    console.error("[App] Failed to register webhooks:", error);
  }

  return null;
};

export default function SKUGeneratorIntro() {
  return (
    <s-page heading="TT SKU Generator">
      {/* App Overview */}
      <s-section heading="App Overview">
        <s-paragraph>
          TT SKU Generator is an automated Shopify app that generates random SKUs
          for your products and variants through webhook listening. No manual action required -
          SKUs are automatically assigned when products or variants are created.
        </s-paragraph>
      </s-section>

      {/* How It Works */}
      <s-section heading="How It Works">
        <s-unordered-list>
          <s-list-item>
            <strong>Webhook Listening</strong> - The app listens to Shopify webhooks for product and variant creation events
          </s-list-item>
          <s-list-item>
            <strong>Auto SKU Generation</strong> - When a product or variant is created without an SKU, the app automatically generates one
          </s-list-item>
          <s-list-item>
            <strong>Instant Assignment</strong> - The generated SKU is immediately assigned to the product/variant via Admin API
          </s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Supported Events */}
      <s-section heading="Supported Events">
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignment="center">
              <s-badge tone="success">Active</s-badge>
              <s-text fontWeight="bold">products/create</s-text>
              <s-text color="subdued">- Fires when a new product is created</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="inline" gap="base" alignment="center">
              <s-badge tone="success">Active</s-badge>
              <s-text fontWeight="bold">products/variants/create</s-text>
              <s-text color="subdued">- Fires when a new variant is added to a product</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* SKU Format Example */}
      <s-section heading="Default SKU Format" slot="aside">
        <s-stack direction="block" gap="base">
          <s-text as="code" fontSize="large">PREFIX-XXXXXXXX</s-text>
          <s-unordered-list>
            <s-list-item><strong>Prefix</strong> - Configurable (default: TT)</s-list-item>
            <s-list-item><strong>Length</strong> - Configurable digits (default: 8)</s-list-item>
            <s-list-item><strong>Type</strong> - Numeric or Alphanumeric</s-list-item>
          </s-unordered-list>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text>Examples:</s-text>
            <s-stack direction="block" gap="small">
              <s-text as="code">TT-73928471</s-text>
              <s-text as="code">TT-A7X9K2P4</s-text>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      {/* Configuration */}
      <s-section heading="Configuration" slot="aside">
        <s-paragraph>
          Go to <s-link href="/app/additional">Settings</s-link> to customize:
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>SKU Prefix</s-list-item>
          <s-list-item>Number of digits</s-list-item>
          <s-list-item>Numeric or Alphanumeric format</s-list-item>
        </s-unordered-list>
      </s-section>

      {/* Status */}
      <s-section heading="App Status" slot="aside">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignment="center">
            <s-badge tone="success">●</s-badge>
            <s-text>Webhook listeners active</s-text>
          </s-stack>
          <s-stack direction="inline" gap="base" alignment="center">
            <s-badge tone="success">●</s-badge>
            <s-text>Auto SKU generation enabled</s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
