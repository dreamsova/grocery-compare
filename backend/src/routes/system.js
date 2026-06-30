import { Router } from 'express';
import { dbMode, dbPath } from '../db.js';
import { receiptStorageStatus } from '../storage/receipts.js';

const router = Router();

function configured(value) {
  const clean = value?.trim();
  return Boolean(clean && !clean.startsWith('your-') && !clean.includes('...'));
}

router.get('/status', (_req, res) => {
  const databaseUrlConfigured = configured(process.env.DATABASE_URL);
  const supabaseUrlConfigured = configured(process.env.SUPABASE_URL);
  const supabaseKeyConfigured = configured(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const supabaseBucketConfigured = configured(process.env.SUPABASE_STORAGE_BUCKET);
  const isTmpSqlite = dbPath.startsWith('/tmp/') || dbPath.startsWith('/private/tmp/');
  const receiptStorage = receiptStorageStatus();

  res.json({
    app: {
      name: 'Grocery Compare',
      environment: process.env.NODE_ENV || 'development',
    },
    persistence: {
      active: dbMode,
      databasePath: dbMode === 'sqlite' ? dbPath : null,
      ephemeral: dbMode === 'sqlite' ? isTmpSqlite : false,
      productionTarget: 'supabase_postgres',
      postgresConfigured: databaseUrlConfigured,
      supabaseConfigured: supabaseUrlConfigured && supabaseKeyConfigured,
    },
    receiptStorage: {
      active: receiptStorage.active,
      productionTarget: 'supabase_storage',
      supabaseStorageConfigured: supabaseUrlConfigured && supabaseKeyConfigured && supabaseBucketConfigured,
      bucket: receiptStorage.bucket,
      maxUploadMb: 1.5,
    },
    readiness: {
      schemaReady: true,
      currentDemoSafe: true,
      productionReady: databaseUrlConfigured && supabaseUrlConfigured && supabaseKeyConfigured && supabaseBucketConfigured,
      nextStep: databaseUrlConfigured
        ? 'Add/verify Render Supabase env vars, then run smoke tests against production.'
        : 'Add DATABASE_URL plus Supabase server-only keys in Render.',
    },
  });
});

export default router;
