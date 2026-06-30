# Supabase / Postgres Persistence

This repo is currently runnable as a single Express service with SQLite for local and demo deployments. The production persistence target is Supabase Postgres.

## Why Supabase

- Managed Postgres for real relational data
- Durable storage beyond Render free-instance restarts
- Optional private Storage bucket for receipt images
- Clear interview story: SQLite demo first, Postgres production path next

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run [`supabase/schema.sql`](supabase/schema.sql).
4. Create a private Storage bucket named `receipts`.
5. Add production environment variables in Render:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
SUPABASE_STORAGE_BUCKET=receipts
DATABASE_URL=postgresql://...
```

## Current Status

The schema is production-ready, but the Express routes still use the synchronous SQLite adapter. A full Postgres switch should be done by replacing `backend/src/db.js` with an async repository layer and updating route handlers to `await` database calls.

For the current public demo, receipt images are stored in SQLite as base64 evidence so the feature works immediately. In production, store the image file in Supabase Storage and keep only `storage_path` plus metadata in `receipt_images`.

## Migration Plan

1. Add a repository layer with methods such as `getProduct`, `createProduct`, `listReceipts`, and `insertReceipt`.
2. Implement two adapters: SQLite for local demo, Postgres/Supabase for production.
3. Switch routes from direct `db.prepare(...)` calls to repository methods.
4. Move receipt image bytes to Supabase Storage.
5. Use Postgres row-level security when replacing the current custom JWT auth.
