# Grocery Compare

Grocery Compare is a full-stack grocery list comparison app. It helps shoppers compare a whole grocery list across nearby stores instead of checking one item at a time.

The current public v1 uses the Kroger Product API for live Kroger-family store prices, including Mariano's and other nearby Kroger-owned banners. The codebase is being structured around pluggable data sources so future sources such as receipt-verified community prices, Open Food Facts, Open Prices, or partner APIs can be added without rewriting the app.

## What It Does

- User accounts with cookie-based JWT auth
- Shopping list CRUD with collaborators
- Live Kroger-family store search by ZIP code
- Whole-list price comparison across nearby stores
- Product browsing by category and trending grocery items
- Product enrichment from Open Food Facts and USDA FoodData Central
- Price history snapshots
- Receipt image upload for receipt/shelf-tag evidence
- Socket.IO hooks for realtime list updates
- Price provenance: official API, manual community price, or receipt-verified price

## Live Demo

Public demo:

```text
https://grocery-compare-outx.onrender.com
```

Demo login:

```text
demo@grocerycompare.com / demo1234
```

## Interview Demo Script

Use this flow for a quick product walkthrough:

1. Open the public demo and click `Try Demo Account`.
2. Explain the problem: grocery prices are local, store-specific, and hard to compare item by item.
3. Open the `Compare` tab. The app starts with a realistic basket: eggs, milk, bread, bananas, and chicken.
4. Run the comparison for ZIP code `60614`.
5. Point out the result summary: cheapest store, potential savings, matched item count, and data source.
6. Open a product and click `Enrich Data` to show Open Food Facts / USDA metadata and nutrition.
7. Upload a receipt image on a product to show evidence-backed community prices.
8. Explain the architecture: Kroger prices come from an official API; stores without public APIs should use manual or receipt-verified community prices instead of brittle scraping.
9. Mention the production persistence path: local mode uses SQLite; production switches to Supabase/Postgres plus Supabase Storage when the Render env vars are configured.

## Tech Stack

- Frontend: vanilla SPA served from Express
- Backend: Node.js, Express, Socket.IO
- Database: SQLite locally, Supabase/Postgres in production via `DATABASE_URL`
- External APIs: Kroger Product API, Open Food Facts, USDA FoodData Central
- Deployment target: Render or Railway for the current Express app
- Receipt storage: SQLite base64 locally, private Supabase Storage bucket in production

## Local Setup

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3001`.

Seed demo data:

```bash
cd backend
npm run seed
```

Demo login after seeding:

```text
demo@grocerycompare.com / demo1234
```

## Environment Variables

See [backend/.env.example](backend/.env.example).

Required for live Kroger data:

```text
KROGER_CLIENT_ID
KROGER_CLIENT_SECRET
JWT_SECRET
```

Optional for higher USDA rate limits:

```text
USDA_FDC_API_KEY
```

If no USDA key is configured, the app uses USDA's public low-volume `DEMO_KEY` for portfolio/demo usage.

Never commit real `.env` files or API secrets.

For the Supabase/Postgres production path, see [SUPABASE_POSTGRES.md](SUPABASE_POSTGRES.md).

## Data Source Strategy

The interview-ready direction is not "scrape every grocery store." It is a multi-source grocery intelligence system:

- Official API source: Kroger live prices
- Community source: user-submitted or receipt-verified prices
- Open product catalog: Open Food Facts for packaged-product metadata, images, labels, and nutrition labels
- Government nutrition reference: USDA FoodData Central for standardized nutrition data
- Future store metadata: Google Places or retailer location APIs

This makes the product more reliable and easier to explain than depending on brittle website scraping.

The `/api/sources` endpoint exposes the source registry used by the UI. Product detail pages can call `/api/products/:id/enrich` to fetch and cache metadata from open sources.

## SQLite vs Supabase

The app uses SQLite by default because it is simple, local, and easy to ship as one Express service. SQLite is a database engine that stores data in a file, which is great for development and portfolio demos.

Supabase is a managed backend platform built around Postgres. It gives the app durable cloud storage, SQL, auth options, storage buckets for receipt images, logs, API access, and security policies. In production, setting `DATABASE_URL` switches the app to Supabase/Postgres so user data survives restarts and deploys.

In short:

- SQLite: simple file database, best for local/demo mode.
- Supabase/Postgres: hosted production database and storage platform, best for real users.

## Data Trust Layer

Every price snapshot can carry provenance fields:

```text
source_label
source_kind
confidence
evidence_note
submitted_by
submitted_at
```

Examples:

- `official_api`: fetched from the Kroger Product API, high confidence.
- `receipt_verified`: submitted by a user with a receipt or shelf-tag note.
- `manual`: user-submitted price without hard evidence yet.
- `legacy`: older demo fields kept for backward compatibility.

This lets the app support Costco, Trader Joe's, Aldi, and other stores without unsafe scraping. They can enter through community or receipt-verified prices while Kroger remains the official live API source.

Receipt images are available as an additional evidence layer. Local mode stores small receipt images in SQLite so the feature works immediately. Production stores image files in a private Supabase Storage bucket and keeps `storage_path` metadata in Postgres.

## Verification

Syntax check:

```bash
npm run check
```

Smoke test a running local service:

```bash
npm run smoke
```

Smoke test the public demo, including Kroger compare:

```bash
SMOKE_BASE_URL=https://grocery-compare-outx.onrender.com SMOKE_COMPARE=true npm run smoke
```

Smoke test a Supabase-backed deployment:

```bash
SMOKE_BASE_URL=https://grocery-compare-outx.onrender.com \
SMOKE_EXPECT_PERSISTENCE=postgres \
SMOKE_EXPECT_RECEIPT_STORAGE=supabase_storage \
npm run smoke
```

## Deployment Notes

The app is deployable as a single Node service. Without `DATABASE_URL`, it uses SQLite. With `DATABASE_URL` plus Supabase server-side keys, it uses Supabase/Postgres and private Supabase Storage for receipt evidence.

For Render, this repo includes [render.yaml](render.yaml). Add environment variables in the Render dashboard instead of committing secrets. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment checklist.

## Security Notes

- `.env`, SQLite database files, local browser captures, and agent cache files are ignored by Git.
- Kroger credentials are used server-side only.
- Public deployments should set a strong `JWT_SECRET`, restrict CORS origins, and add rate limiting before real users.
