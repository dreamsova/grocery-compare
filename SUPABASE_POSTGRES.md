# Supabase / Postgres Persistence

This repo runs as a single Express service with a selectable persistence layer:

- Local/default: SQLite file storage for fast demos.
- Production: Supabase Postgres when `DATABASE_URL` is configured.

Receipt images also switch automatically: local/default stores small images as SQLite base64, while production stores image bytes in Supabase Storage and keeps `storage_path` metadata in Postgres.

## Why Supabase

- Managed Postgres for real relational data
- Durable storage beyond Render free-instance restarts
- Optional private Storage bucket for receipt images
- Clear interview story: SQLite demo first, Postgres production path next

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run [`supabase/schema.sql`](supabase/schema.sql) and enable RLS when prompted.
4. Create a private Storage bucket named `receipts`.
5. Add production environment variables in Render:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
SUPABASE_STORAGE_BUCKET=receipts
DATABASE_URL=postgresql://...
```

## Current Status

The Express routes support both adapters. `backend/src/db.js` uses SQLite by default and switches to Postgres when `DATABASE_URL` is present. Receipt uploads use Supabase Storage when `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` are configured.

The app exposes `/api/system/status` and shows a Production Readiness card in the dashboard so the running product can explain whether it is in SQLite demo mode or Supabase/Postgres production mode.

## Verification

After setting Render environment variables, run:

```bash
SMOKE_BASE_URL=https://your-render-url.onrender.com \
SMOKE_EXPECT_PERSISTENCE=postgres \
SMOKE_EXPECT_RECEIPT_STORAGE=supabase_storage \
npm run smoke
```

The production app should report `persistence.active = postgres` and `receiptStorage.active = supabase_storage`.
