/**
 * Seed script — creates a demo user + sample shopping lists
 * Run: node scripts/seed.js
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../src/db.js';

// ── Demo user ──────────────────────────────────────────────────────
const DEMO_EMAIL    = 'demo@grocerycompare.com';
const DEMO_PASSWORD = 'demo1234';
const DEMO_NAME     = 'Demo User';

// ── Helper ────────────────────────────────────────────────────────
async function upsertUser(email, password, name) {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`User "${email}" already exists, skipping.`);
    return existing.id;
  }
  const id   = nanoid();
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(`INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)`)
    .run(id, email, hash, name);
  console.log(`Created user: ${email} / ${password}`);
  return id;
}

async function createList(name, ownerId) {
  const existing = await db.prepare('SELECT id FROM shopping_lists WHERE name = ? AND owner_id = ?').get(name, ownerId);
  if (existing) return existing.id;
  const id = nanoid();
  const token = nanoid(16);
  await db.prepare(`INSERT INTO shopping_lists (id, name, owner_id, share_token) VALUES (?, ?, ?, ?)`)
    .run(id, name, ownerId, token);
  return id;
}

async function addProduct(name, imageUrl, createdBy, metadata = {}) {
  const existing = await db.prepare('SELECT id FROM products WHERE name = ? AND created_by = ?').get(name, createdBy);
  if (existing) return existing.id;
  const id = nanoid();
  await db.prepare(`INSERT INTO products
    (id, name, image_url, created_by, brand, size)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, imageUrl ?? null, createdBy, metadata.brand ?? null, metadata.size ?? null);
  return id;
}

async function addProductToList(listId, productId, addedBy, qty = 1, notes = null) {
  const existing = await db.prepare('SELECT id FROM list_items WHERE list_id = ? AND product_id = ?').get(listId, productId);
  if (existing) return;
  await db.prepare(`INSERT INTO list_items (id, list_id, product_id, quantity, added_by, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), listId, productId, qty, addedBy, notes);
}

async function addPrice(productId, store, price) {
  const existing = await db.prepare(
    'SELECT id FROM price_snapshots WHERE product_id = ? AND store = ? AND price = ? LIMIT 1'
  ).get(productId, store, price);
  if (existing) return;
  await db.prepare(`INSERT INTO price_snapshots
    (id, product_id, store, price, source_label, source_kind, confidence, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    nanoid(),
    productId,
    store,
    price,
    store === 'kroger' ? 'Kroger Product API' : `${store} demo price`,
    store === 'kroger' ? 'official_api' : 'manual',
    store === 'kroger' ? 0.98 : 0.7,
  );
}

export async function seedDemoData() {
  const userId = await upsertUser(DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME);

  // List 1: Weekly Groceries
  const weeklyId = await createList('Weekly Groceries', userId);
  const items1 = [
    { name: 'Large White Eggs 18ct',         img: 'https://www.kroger.com/product/images/medium/front/0001111060933', brand: 'Kroger', size: '18 ct', kroger: 3.99 },
    { name: 'Whole Milk 1 Gallon',            img: 'https://www.kroger.com/product/images/medium/front/0001111042850', brand: 'Kroger', size: '1 gal', kroger: 4.49 },
    { name: 'Boneless Skinless Chicken Breast', img: 'https://www.kroger.com/product/images/medium/front/0028334900000', brand: 'Kroger', size: 'per lb', kroger: 2.49 },
    { name: 'Chobani Greek Yogurt Plain',     img: 'https://www.kroger.com/product/images/medium/front/0084865810041', brand: 'Chobani', size: '5.3 oz', kroger: 1.69 },
    { name: 'Sourdough Bread Loaf',           img: null, brand: 'Bakery Fresh', size: '1 loaf', kroger: 4.99 },
    { name: 'Roma Tomatoes',                  img: null, brand: 'Produce', size: 'per lb', kroger: 1.29 },
    { name: 'Baby Spinach 5oz',               img: null, brand: 'Simple Truth', size: '5 oz', kroger: 3.49 },
  ];

  for (const item of items1) {
    const pid = await addProduct(item.name, item.img, userId, item);
    await addProductToList(weeklyId, pid, userId);
    await addPrice(pid, 'kroger', item.kroger);
  }
  console.log(`Seeded list: "Weekly Groceries" with ${items1.length} items`);

  // List 2: BBQ Party
  const bbqId = await createList('BBQ Party', userId);
  const items2 = [
    { name: 'Ground Beef 80/20 1lb',          img: null, kroger: 5.99 },
    { name: 'Hot Dog Buns 8ct',               img: null, kroger: 2.49 },
    { name: 'Kingsford Charcoal Briquettes',  img: null, kroger: 9.99 },
    { name: 'KC Masterpiece BBQ Sauce',       img: null, kroger: 3.29 },
    { name: 'Cheddar Cheese Slices 12ct',     img: null, kroger: 4.49 },
    { name: 'Lettuce Iceberg Head',           img: null, kroger: 1.99 },
    { name: 'Heinz Ketchup 32oz',             img: null, kroger: 3.79 },
  ];

  for (const item of items2) {
    const pid = await addProduct(item.name, item.img, userId, item);
    await addProductToList(bbqId, pid, userId);
    await addPrice(pid, 'kroger', item.kroger);
  }
  console.log(`Seeded list: "BBQ Party" with ${items2.length} items`);

  // List 3: Breakfast Week
  const bfastId = await createList('Breakfast Week', userId);
  const items3 = [
    { name: 'Quaker Old Fashioned Oats 42oz', img: null, kroger: 5.49 },
    { name: 'Bananas 1lb',                    img: null, kroger: 0.59 },
    { name: 'Blueberries 6oz',                img: null, kroger: 3.99 },
    { name: 'Orange Juice 52oz',              img: null, kroger: 4.29 },
    { name: 'Butter Unsalted 1lb',            img: null, kroger: 4.99 },
    { name: 'Maple Syrup Pure 12oz',          img: null, kroger: 7.99 },
  ];

  for (const item of items3) {
    const pid = await addProduct(item.name, item.img, userId, item);
    await addProductToList(bfastId, pid, userId);
    await addPrice(pid, 'kroger', item.kroger);
  }
  console.log(`Seeded list: "Breakfast Week" with ${items3.length} items`);

  console.log('\nSeed complete!');
  console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDemoData().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
