import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getRecentLogs, clearOldLogs, isDev } from "../utils/logger.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Only load logs in development mode
  if (!isDev) {
    return { logs: [], shop, isDev: false };
  }

  // Get last 10 logs
  const logs = await getRecentLogs(shop, 10);

  return { logs, shop, isDev: true };
};

export const action = async ({ request }) => {
  // Skip in production
  if (!isDev) return null;

  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "clear") {
    await clearOldLogs(shop, 0); // Clear all logs
    return { success: true };
  }

  return null;
};

export default function LogsPage() {
  const { logs, shop, isDev } = useLoaderData();
  const fetcher = useFetcher();

  // Show message in production
  if (!isDev) {
    return (
      <s-page heading="Debug Logs">
        <s-box padding="large">
          <s-text color="subdued">
            Debug logs are only available in development mode.
          </s-text>
        </s-box>
      </s-page>
    );
  }

  const handleClear = () => {
    if (confirm("Clear all logs?")) {
      fetcher.submit({ action: "clear" }, { method: "POST" });
    }
  };

  return (
    <s-page heading="Debug Logs (Dev Mode)">
      <s-button slot="primary-action" variant="tertiary" onClick={handleClear}>
        Clear
      </s-button>

      <s-text>Shop: {shop}</s-text>

      {logs.length === 0 ? (
        <s-text color="subdued">No logs</s-text>
      ) : (
        <s-stack direction="block" gap="base">
          {logs.map((log) => (
            <s-box
              key={log.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background={log.level === "error" ? "critical-subdued" : "subdued"}
            >
              <s-stack direction="block" gap="small">
                <s-stack direction="inline" gap="base" alignment="center">
                  <s-badge tone={log.level === "error" ? "critical" : "info"}>
                    {log.level.toUpperCase()}
                  </s-badge>
                  <s-text fontWeight="bold">{log.source}</s-text>
                  <s-text color="subdued" fontSize="small">
                    {new Date(log.createdAt).toLocaleTimeString()}
                  </s-text>
                </s-stack>
                <s-text>{log.message}</s-text>
                {log.details && (
                  <s-box padding="small" borderWidth="base" borderRadius="base">
                    <pre style={{ margin: 0, fontSize: "12px", overflow: "auto" }}>
                      <code>{JSON.stringify(JSON.parse(log.details), null, 2)}</code>
                    </pre>
                  </s-box>
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      )}
    </s-page>
  );
}
