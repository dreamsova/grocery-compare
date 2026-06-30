# Grocery Compare Project Context

## Product

Grocery Compare helps shoppers compare a whole grocery list across nearby stores. The app should optimize for clear price provenance: where a price came from, when it was fetched, and how trustworthy it is.

The product direction is a data-trust-first grocery comparison app: official APIs where possible, and community or receipt-verified prices where official APIs do not exist.

## Current Architecture

- `backend/src/index.js`: Express entry point and Socket.IO setup
- `backend/public/index.html`: single-page frontend
- `backend/src/routes`: API routes
- `backend/src/kroger.js`: Kroger API client
- `backend/src/dataSources`: normalized source adapters for Kroger, Open Food Facts, USDA, and product enrichment
- `backend/src/db.js`: SQLite database setup
- `backend/src/routes/system.js`: persistence/storage readiness endpoint
- `backend/scripts/seed.js`: demo data
- `backend/scripts/smoke.js`: post-deploy smoke test
- `supabase/schema.sql`: production Postgres schema target
- `SUPABASE_POSTGRES.md`: Supabase persistence migration notes

## Commands

```bash
cd backend
npm install
npm run dev
npm run seed
npm run check
SMOKE_BASE_URL=https://grocery-compare-outx.onrender.com SMOKE_COMPARE=true npm run smoke
```

## Environment

Use `backend/.env.example` as the public template. Never read, print, commit, or summarize real `.env` values.

Required secrets:

- `JWT_SECRET`
- `KROGER_CLIENT_ID`
- `KROGER_CLIENT_SECRET`

Optional:

- `DB_PATH`
- `CORS_ORIGIN`
- `USDA_FDC_API_KEY` for higher USDA FoodData Central rate limits. Without it, the app uses `DEMO_KEY`.
- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` are documented for the production Supabase/Postgres path.

## Safety Rules

- Do not commit `.env`, local SQLite databases, `.playwright-mcp`, `tmp`, or `.report_build`.
- Do not scrape Costco, Trader Joe's, Instacart, or other sites as a core production dependency without checking terms and stability.
- Prefer official APIs, open datasets, or user-verified receipt/manual price sources.
- Keep API keys on the server.

## Interview Story

The project should be described as a multi-source grocery intelligence system:

- Official live price data from Kroger
- Community/receipt-verified prices for stores without public APIs
- Product metadata from Open Food Facts
- Nutrition reference data from USDA FoodData Central
- Store distance and convenience signals
- Whole-list optimization instead of one-item price comparison

## Product Enrichment

The app has a source registry at `/api/sources` and a product enrichment endpoint at `/api/products/:id/enrich`.

Use data sources by role:

- Kroger: official local price data and store comparison
- Community prices: Costco, Trader Joe's, Aldi, and other stores without safe public APIs
- Open Food Facts: packaged-product metadata, package images, labels, and nutrition labels
- USDA FoodData Central: standardized nutrition reference data

External data-source failures should degrade gracefully. The app should still work if Open Food Facts or USDA is temporarily unavailable.

## Price Provenance

`price_snapshots` supports:

- `source_label`: human-readable source, e.g. Kroger Product API or Costco community price
- `source_kind`: `official_api`, `receipt_verified`, `manual`, or `legacy`
- `confidence`: trust score for display and ranking
- `evidence_note`: optional receipt, shelf-tag, or manual note
- `submitted_by` and `submitted_at`: who contributed the price and when

## Receipt Evidence

Products can have receipt/shelf-tag image evidence through `receipt_images`.

The demo stores small PNG/JPG/WEBP images as base64 in SQLite so the feature works immediately on localhost and Render. Production should move image bytes to a private Supabase Storage bucket and keep `storage_path` metadata in Postgres.

## UI Direction

Keep the interface simple, readable, and product-focused. Avoid oversized marketing typography. The landing page should explain the product in one glance: compare grocery baskets, inspect source-backed prices, upload receipt evidence, and enrich products from open data.

The dashboard should show production readiness clearly: current SQLite demo storage, Supabase/Postgres target, and receipt storage status.
