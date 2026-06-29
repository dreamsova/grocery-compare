/**
 * Seed script — creates a demo user + sample shopping lists
 * Run: node scripts/seed.js
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../src/db.js';

// ── Demo user ──────────────────────────────────────────────────────
const DEMO_EMAIL    = 'demo@grocerycompare.com';
const DEMO_PASSWORD = 'demo1234';
const DEMO_NAME     = 'Demo User';

// ── Helper ────────────────────────────────────────────────────────
function upsertUser(email, password, name) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`User "${email}" already exists, skipping.`);
    return existing.id;
  }
  const id   = nanoid();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)`)
    .run(id, email, hash, name);
  console.log(`Created user: ${email} / ${password}`);
  return id;
}

function createList(name, ownerId) {
  const existing = db.prepare('SELECT id FROM shopping_lists WHERE name = ? AND owner_id = ?').get(name, ownerId);
  if (existing) return existing.id;
  const id = nanoid();
  const token = nanoid(16);
  db.prepare(`INSERT INTO shopping_lists (id, name, owner_id, share_token) VALUES (?, ?, ?, ?)`)
    .run(id, name, ownerId, token);
  return id;
}

function addProduct(name, imageUrl, createdBy) {
  const existing = db.prepare('SELECT id FROM products WHERE name = ? AND created_by = ?').get(name, createdBy);
  if (existing) return existing.id;
  const id = nanoid();
  db.prepare(`INSERT INTO products (id, name, image_url, created_by) VALUES (?, ?, ?, ?)`)
    .run(id, name, imageUrl ?? null, createdBy);
  return id;
}

function addProductToList(listId, productId, addedBy, qty = 1, notes = null) {
  const existing = db.prepare('SELECT id FROM list_items WHERE list_id = ? AND product_id = ?').get(listId, productId);
  if (existing) return;
  db.prepare(`INSERT INTO list_items (id, list_id, product_id, quantity, added_by, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(nanoid(), listId, productId, qty, addedBy, notes);
}

function addPrice(productId, store, price) {
  db.prepare(`INSERT INTO price_snapshots (id, product_id, store, price) VALUES (?, ?, ?, ?)`)
    .run(nanoid(), productId, store, price);
}

// ── Seed ──────────────────────────────────────────────────────────
const userId = upsertUser(DEMO_EMAIL, DEMO_PASSWORD, DEMO_NAME);

// List 1: Weekly Groceries
const weeklyId = createList('Weekly Groceries', userId);
const items1 = [
  { name: 'Large White Eggs 18ct',         img: 'https://www.kroger.com/product/images/medium/front/0001111060933', kroger: 3.99 },
  { name: 'Whole Milk 1 Gallon',            img: 'https://www.kroger.com/product/images/medium/front/0001111042850', kroger: 4.49 },
  { name: 'Boneless Skinless Chicken Breast', img: 'https://www.kroger.com/product/images/medium/front/0028334900000', kroger: 2.49 },
  { name: 'Chobani Greek Yogurt Plain',     img: 'https://www.kroger.com/product/images/medium/front/0084865810041', kroger: 1.69 },
  { name: 'Sourdough Bread Loaf',           img: null, kroger: 4.99 },
  { name: 'Roma Tomatoes',                  img: null, kroger: 1.29 },
  { name: 'Baby Spinach 5oz',               img: null, kroger: 3.49 },
];

for (const item of items1) {
  const pid = addProduct(item.name, item.img, userId);
  addProductToList(weeklyId, pid, userId);
  addPrice(pid, 'kroger', item.kroger);
}
console.log(`Seeded list: "Weekly Groceries" with ${items1.length} items`);

// List 2: BBQ Party
const bbqId = createList('BBQ Party', userId);
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
  const pid = addProduct(item.name, item.img, userId);
  addProductToList(bbqId, pid, userId);
  addPrice(pid, 'kroger', item.kroger);
}
console.log(`Seeded list: "BBQ Party" with ${items2.length} items`);

// List 3: Breakfast Week
const bfastId = createList('Breakfast Week', userId);
const items3 = [
  { name: 'Quaker Old Fashioned Oats 42oz', img: null, kroger: 5.49 },
  { name: 'Bananas 1lb',                    img: null, kroger: 0.59 },
  { name: 'Blueberries 6oz',                img: null, kroger: 3.99 },
  { name: 'Orange Juice 52oz',              img: null, kroger: 4.29 },
  { name: 'Butter Unsalted 1lb',            img: null, kroger: 4.99 },
  { name: 'Maple Syrup Pure 12oz',          img: null, kroger: 7.99 },
];

for (const item of items3) {
  const pid = addProduct(item.name, item.img, userId);
  addProductToList(bfastId, pid, userId);
  addPrice(pid, 'kroger', item.kroger);
}
console.log(`Seeded list: "Breakfast Week" with ${items3.length} items`);

console.log('\n✅ Seed complete!');
console.log(`   Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
