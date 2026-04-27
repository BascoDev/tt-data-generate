import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    await authenticate.admin(request);

    return {
      // eslint-disable-next-line no-undef
      apiKey: process.env.SHOPIFY_API_KEY || ""
    };
  } catch (error) {
    console.error("[App Loader] Error:", error);
    // Return default values even if auth fails
    return {
      // eslint-disable-next-line no-undef
      apiKey: process.env.SHOPIFY_API_KEY || ""
    };
  }
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">SKU Generator</s-link>
        <s-link href="/app/smart-collection">Smart Collection</s-link>
        <s-link href="/app/additional">Settings</s-link>

      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
