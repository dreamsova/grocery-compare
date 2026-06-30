# Deployment Guide

This project is deployable as one full-stack Node service: Express serves both the API and the frontend SPA.

## Public Demo Architecture

- GitHub hosts the source code.
- Render runs the Node/Express app.
- Without Supabase env vars, the free demo stores SQLite at `/tmp/grocery.db` and seeds sample data on startup.
- With Supabase env vars, the service uses Supabase/Postgres and the private `receipts` Storage bucket.
- Kroger live product data is fetched server-side with Kroger API credentials.

The SQLite setup is intentionally demo-first. Data can reset when Render restarts or redeploys the service. For durable production data, configure Supabase/Postgres or use a paid Render service with a persistent disk.

## Deploy on Render

1. Push the latest code to GitHub.
2. Open Render and create a new Blueprint from this repository.
3. Let Render read `render.yaml`.
4. Add the required secret environment variables when Render asks for them.
5. Deploy the service.

Required variables:

```text
JWT_SECRET
KROGER_CLIENT_ID
KROGER_CLIENT_SECRET
CORS_ORIGIN
```

Supabase production variables:

```text
DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET=receipts
```

Recommended values:

```text
JWT_SECRET=<a long random string, 32+ characters>
CORS_ORIGIN=https://<your-render-service>.onrender.com
```

`SEED_DEMO_DATA=true` is already set in `render.yaml` so the public demo starts with sample lists and a demo login.

Demo login after deploy:

```text
demo@grocerycompare.com / demo1234
```

## Verify After Deploy

Open these URLs:

```text
https://<your-render-service>.onrender.com
https://<your-render-service>.onrender.com/api/health
```

The health endpoint should return JSON like:

```json
{
  "ok": true,
  "ts": "2026-06-29T00:00:00.000Z"
}
```

Then test the product flow:

1. Log in with the demo account.
2. Open the sample grocery list.
3. Search nearby Kroger-family stores by ZIP code.
4. Compare the list across stores.
5. Add a manual or receipt-verified price.

For Supabase-backed deploys, also check:

```bash
SMOKE_BASE_URL=https://<your-render-service>.onrender.com \
SMOKE_EXPECT_PERSISTENCE=postgres \
SMOKE_EXPECT_RECEIPT_STORAGE=supabase_storage \
npm run smoke
```

## Security Checklist

- Never commit `backend/.env`.
- Never commit `backend/grocery.db`.
- Never paste secrets into README, screenshots, commits, or issues.
- Keep Kroger credentials server-side only.
- Rotate credentials if they were ever shared in a PDF, screenshot, chat, or public repo.

## Production Hardening

For a larger public product, add:

- Row-level security for per-user data.
- Rate limiting on auth and search routes.
- More durable background jobs for scheduled price refreshes.
- A moderation flow for receipt upload or user-submitted price verification.
