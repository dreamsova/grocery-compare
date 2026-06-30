import sqlite3Wasm from 'node-sqlite3-wasm';
const { Database } = sqlite3Wasm;
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join } from 'path';
import { mkdirSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.DB_PATH;
const dbPath = configuredPath
  ? (isAbsolute(configuredPath) ? configuredPath : join(__dirname, '..', configuredPath))
  : join(__dirname, '..', 'grocery.db');

mkdirSync(dirname(dbPath), { recursive: true });

// node-sqlite3-wasm uses a .lock directory for locking. If the process was
// killed unexpectedly, the stale lock prevents restart. Remove it on startup.
try { rmSync(dbPath + '.lock', { recursive: true, force: true }); } catch {}

const db = new Database(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node-sqlite3-wasm's .run() requires an array, unlike better-sqlite3 which
// accepts rest args. Patch prepare() so both styles work transparently.
const _prepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = _prepare(sql);
  const _run = stmt.run.bind(stmt);
  const _get = stmt.get.bind(stmt);
  const _all = stmt.all.bind(stmt);
  stmt.run = (...args) => _run(args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  stmt.get = (...args) => _get(args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  stmt.all = (...args) => _all(args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
  return stmt;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    ic_plus INTEGER DEFAULT 0,
    wm_plus INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    walmart_url TEXT,
    instacart_url TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS price_snapshots (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    store TEXT NOT NULL,
    price REAL NOT NULL,
    in_stock INTEGER DEFAULT 1,
    scraped_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_price_product_store_time
    ON price_snapshots(product_id, store, scraped_at DESC);

  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    share_token TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS list_collaborators (
    list_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'editor',
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (list_id, user_id),
    FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    checked INTEGER DEFAULT 0,
    added_by TEXT NOT NULL,
    store_choice TEXT,
    notes TEXT,
    position INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS receipt_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    price_snapshot_id TEXT,
    store TEXT,
    image_data TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    note TEXT,
    uploaded_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (price_snapshot_id) REFERENCES price_snapshots(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_receipt_images_product_time
    ON receipt_images(product_id, created_at DESC);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(col => col.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('price_snapshots', 'source_label', 'TEXT');
ensureColumn('price_snapshots', 'source_kind', 'TEXT');
ensureColumn('price_snapshots', 'confidence', 'REAL');
ensureColumn('price_snapshots', 'evidence_note', 'TEXT');
ensureColumn('price_snapshots', 'submitted_by', 'TEXT');
ensureColumn('price_snapshots', 'submitted_at', 'TEXT');
ensureColumn('products', 'brand', 'TEXT');
ensureColumn('products', 'size', 'TEXT');
ensureColumn('products', 'barcode', 'TEXT');
ensureColumn('products', 'nutrition_json', 'TEXT');
ensureColumn('products', 'external_sources_json', 'TEXT');
ensureColumn('products', 'enriched_at', 'TEXT');

db.exec(`
  UPDATE price_snapshots
  SET
    source_label = COALESCE(source_label,
      CASE store
        WHEN 'kroger' THEN 'Kroger Product API'
        WHEN 'costco' THEN 'Costco community price'
        WHEN 'trader_joes' THEN 'Trader Joe''s community price'
        WHEN 'aldi' THEN 'Aldi community price'
        WHEN 'manual' THEN 'Manual community price'
        WHEN 'walmart' THEN 'Legacy Walmart price'
        WHEN 'instacart' THEN 'Legacy Instacart price'
        ELSE store
      END
    ),
    source_kind = COALESCE(source_kind,
      CASE store
        WHEN 'kroger' THEN 'official_api'
        WHEN 'walmart' THEN 'legacy'
        WHEN 'instacart' THEN 'legacy'
        ELSE 'manual'
      END
    ),
    confidence = COALESCE(confidence,
      CASE store
        WHEN 'kroger' THEN 0.98
        WHEN 'walmart' THEN 0.55
        WHEN 'instacart' THEN 0.55
        ELSE 0.7
      END
    ),
    submitted_at = COALESCE(submitted_at, scraped_at)
  WHERE source_label IS NULL
     OR source_kind IS NULL
     OR confidence IS NULL
     OR submitted_at IS NULL;
`);

export default db;
export { dbPath };
