import { Router } from 'express';
import { dbPath } from '../db.js';

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

  res.json({
    app: {
      name: 'Grocery Compare',
      environment: process.env.NODE_ENV || 'development',
    },
    persistence: {
      active: 'sqlite',
      databasePath: dbPath,
      ephemeral: isTmpSqlite,
      productionTarget: 'supabase_postgres',
      postgresConfigured: databaseUrlConfigured,
      supabaseConfigured: supabaseUrlConfigured && supabaseKeyConfigured,
    },
    receiptStorage: {
      active: 'sqlite_base64',
      productionTarget: 'supabase_storage',
      supabaseStorageConfigured: supabaseUrlConfigured && supabaseKeyConfigured && supabaseBucketConfigured,
      maxUploadMb: 1.5,
    },
    readiness: {
      schemaReady: true,
      currentDemoSafe: true,
      productionReady: databaseUrlConfigured && supabaseUrlConfigured && supabaseKeyConfigured && supabaseBucketConfigured,
      nextStep: databaseUrlConfigured
        ? 'Switch route data access from SQLite adapter to Postgres repository.'
        : 'Create a Supabase project, run supabase/schema.sql, and add DATABASE_URL plus Supabase server-only keys.',
    },
  });
});

export default router;
