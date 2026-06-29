# Grocery Compare

Grocery Compare is a full-stack grocery list comparison app. It helps shoppers compare a whole grocery list across nearby stores instead of checking one item at a time.

The current public v1 uses the Kroger Product API for live Kroger-family store prices, including Mariano's and other nearby Kroger-owned banners. The codebase is being structured around pluggable data sources so future sources such as receipt-verified community prices, Open Food Facts, Open Prices, or partner APIs can be added without rewriting the app.

## What It Does

- User accounts with cookie-based JWT auth
- Shopping list CRUD with collaborators
- Live Kroger-family store search by ZIP code
- Whole-list price comparison across nearby stores
- Product browsing by category and trending grocery items
- Price history snapshots
- Socket.IO hooks for realtime list updates

## Tech Stack

- Frontend: vanilla SPA served from Express
- Backend: Node.js, Express, Socket.IO
- Database: SQLite via `node-sqlite3-wasm`
- External API: Kroger Product API
- Deployment target: Render or Railway for the current Express app

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

Never commit real `.env` files or API secrets.

## Data Source Strategy

The interview-ready direction is not "scrape every grocery store." It is a multi-source grocery intelligence system:

- Official API source: Kroger live prices
- Community source: user-submitted or receipt-verified prices
- Product metadata: Open Food Facts and USDA FoodData Central
- Store metadata: Google Places or retailer location APIs

This makes the product more reliable and easier to explain than depending on brittle website scraping.

## Deployment Notes

The app is deployable as a single Node service. Use a persistent disk for SQLite if deploying to Render/Railway, or migrate the database to Supabase/Postgres for a production-grade version.

For Render, this repo includes [render.yaml](render.yaml). Add environment variables in the Render dashboard instead of committing secrets.

## Security Notes

- `.env`, SQLite database files, local browser captures, and agent cache files are ignored by Git.
- Kroger credentials are used server-side only.
- Public deployments should set a strong `JWT_SECRET`, restrict CORS origins, and add rate limiting before real users.

