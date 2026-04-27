# Shopify Harness Rules

## Scope Control
1. Only work inside the current Shopify project workspace.
2. Do not modify unrelated stores, configs, or deployment settings unless instructed.
3. Respect the current project type: theme, app, script, or integration.

## Theme Safety
4. Do not break Liquid structure.
5. Prefer editing the smallest relevant template, section, snippet, or asset.
6. Reuse existing snippets and sections where possible.
7. Avoid broad layout changes unless explicitly requested.
8. Preserve merchant-editable settings when possible.

## Liquid and Frontend
9. Prefer native Shopify objects and Liquid logic before adding JavaScript workarounds.
10. Avoid heavy frontend scripts unless necessary.
11. Do not assume query parameters are reliably available everywhere without verifying theme context.
12. Be careful with product, collection, cart, and customer object availability by template.

## JavaScript
13. Keep scripts lightweight and scoped.
14. Avoid polluting global scope unless required.
15. Prefer event-based logic over timing hacks.
16. Do not introduce frontend behavior that leaks across unrelated pages unless explicitly intended.

## App / API Logic
17. Prefer Admin API patterns where appropriate.
18. Do not overwrite existing values like SKU unless rules explicitly allow it.
19. Treat empty, null, undefined, and equivalent empty states carefully.
20. Log important mutations when the project already has logging structure.

## Data Safety
21. Do not destroy merchant content or settings.
22. Avoid irreversible bulk updates without warning.
23. Be careful with metafields, product data, and variant updates.

## Performance
24. Avoid expensive loops in Liquid when possible.
25. Be careful with large catalogs and collection rendering performance.
26. Keep storefront performance in mind before adding dynamic features.

## Debugging
27. Distinguish between Liquid limitation, theme rendering timing, app embed behavior, and frontend state issue before proposing a fix.
28. When debugging view logic, check whether the source is server-side Liquid, URL parameter handling, localStorage persistence, or app script behavior.