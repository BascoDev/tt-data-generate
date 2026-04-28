# TT Data Generate - Shopify App

A Shopify app built with React Router that provides SKU generation and Smart Collection management driven by multi-location inventory stock levels.

## Features

### 1. SKU Generator
Auto-generate SKU codes for products with configurable rules and settings.

### 2. Smart Collection (Location Stock)
Create and manage Smart Collection rules based on per-location inventory stock:

- **Location Sync** - Manually sync shop locations and create Product Metafield Definitions for each location (`custom.tt-stock-{location-name}`)
- **Inventory Sync** - Background job that walks all products and writes current per-location stock values into product metafields (supports up to 20,000 products)
- **Smart Collection Rules** - Append metafield-based rules to existing Smart Collections:
  - Choose collections and locations via inline badge UI
  - AND / OR logic support with conflict detection
  - Stock threshold configuration
  - Rules are appended (not overwritten) to existing collection rules
- **Saved Configurations** - Keeps the latest 10 rule configurations with timestamp, operator, logic type, threshold, and affected locations

### 3. Webhooks
- `products/create` & `products/update` - Product lifecycle events
- `inventory_levels/update` & `inventory_levels/disconnect` - Real-time inventory sync to product metafields
- `app/uninstalled` & `app/scopes_update` - App lifecycle management

## Tech Stack

- [React Router 7](https://reactrouter.com/)
- [Shopify Admin API 2025-10](https://shopify.dev/docs/api/admin-graphql)
- [Prisma ORM](https://www.prisma.io/) with SQLite (default)
- [Shopify App React Router](https://shopify.dev/docs/api/shopify-app-react-router)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components)

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)

## Local Development

```shell
npm install
npx prisma migrate dev
npx prisma generate
shopify app dev
```

Press `P` to open the app URL. Once installed, you can start development.

### Database Setup

If you encounter table errors (e.g., `The table main.Session does not exist`):

```shell
npx prisma migrate dev
npx prisma generate
```

## Important Notes

### Metafield Definitions
This app creates Product Metafield Definitions under the `custom` namespace with `smartCollectionCondition: { enabled: true }` so they can be used in Smart Collection rules. Due to Shopify API constraints with custom namespaces, the `access` field is intentionally omitted during creation.

### Inventory Sync Limits
The inventory sync job supports up to **20,000 products**. If your catalog exceeds this limit, the sync will be blocked with a clear error message. For larger catalogs, contact support.

### Smart Collection Rule Logic
- Rules are **appended** to existing collection rules, not overwritten
- If a collection already uses AND logic, you cannot append OR rules (and vice versa) - the app will show a user-friendly error

## Build

```shell
npm run build
```

## Deployment

Follow the [Shopify deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host externally. Remember to set `NODE_ENV=production`.

### Database

SQLite is used by default and works for single-instance deployments. For production with multiple instances, switch to PostgreSQL or MySQL by updating the `datasource` in `prisma/schema.prisma`.

## Project Structure

```
app/
├── routes/
│   ├── app._index.jsx           # SKU Generator
│   ├── app.smart-collection.jsx # Smart Collection & Inventory Sync
│   ├── app.additional.jsx       # Settings
│   ├── webhooks.*.jsx           # Webhook handlers
│   └── ...
├── utils/
│   ├── location-stock.server.js # Location/Metafield/Inventory logic
│   └── logger.server.js         # Debug logging
├── db.server.js                 # Prisma client
├── shopify.server.js            # Shopify app setup
└── root.jsx                     # App root

prisma/
└── schema.prisma                # Database schema
```

## License

MIT
