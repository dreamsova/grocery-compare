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
  stmt.run = (...args) => _run(args.length === 1 && Array.isArray(args[0]) ? args[0] : args);
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
`);

export default db;
