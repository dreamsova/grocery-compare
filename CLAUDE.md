# Grocery Compare Project Context

## Product

Grocery Compare helps shoppers compare a whole grocery list across nearby stores. The app should optimize for clear price provenance: where a price came from, when it was fetched, and how trustworthy it is.

## Current Architecture

- `backend/src/index.js`: Express entry point and Socket.IO setup
- `backend/public/index.html`: single-page frontend
- `backend/src/routes`: API routes
- `backend/src/kroger.js`: Kroger API client
- `backend/src/dataSources`: normalized source adapters
- `backend/src/db.js`: SQLite database setup
- `backend/scripts/seed.js`: demo data

## Commands

```bash
cd backend
npm install
npm run dev
npm run seed
npm run check
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

## Safety Rules

- Do not commit `.env`, local SQLite databases, `.playwright-mcp`, `tmp`, or `.report_build`.
- Do not scrape Costco, Trader Joe's, Instacart, or other sites as a core production dependency without checking terms and stability.
- Prefer official APIs, open datasets, or user-verified receipt/manual price sources.
- Keep API keys on the server.

## Interview Story

The project should be described as a multi-source grocery intelligence system:

- Official live price data from Kroger
- Future community/receipt-verified prices for stores without public APIs
- Product metadata from open datasets
- Store distance and convenience signals
- Whole-list optimization instead of one-item price comparison

