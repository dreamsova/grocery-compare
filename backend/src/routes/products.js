import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { searchProducts, findLocations } from '../kroger.js';

const router = Router();
router.use(requireAuth);

function latestPrices(productId) {
  return {
    kroger: db.prepare(
      `SELECT price, scraped_at FROM price_snapshots
       WHERE product_id = ? AND store = 'kroger' ORDER BY scraped_at DESC LIMIT 1`
    ).get(productId) ?? null,
    walmart: db.prepare(
      `SELECT price, scraped_at FROM price_snapshots
       WHERE product_id = ? AND store = 'walmart' ORDER BY scraped_at DESC LIMIT 1`
    ).get(productId) ?? null,
    instacart: db.prepare(
      `SELECT price, scraped_at FROM price_snapshots
       WHERE product_id = ? AND store = 'instacart' ORDER BY scraped_at DESC LIMIT 1`
    ).get(productId) ?? null,
  };
}

// POST /api/products/search — search Kroger for products
// Body: { query, locationId?, zipCode? }
// If no locationId provided, uses zipCode (default 60614) to find nearest store.
router.post('/search', async (req, res) => {
  const { query, locationId, zipCode = '60614', limit = 5 } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query required' });

  try {
    let locId = locationId;
    if (!locId) {
      const locs = await findLocations(zipCode, 1);
      if (!locs.length) return res.status(404).json({ error: 'No Kroger stores found near ' + zipCode });
      locId = locs[0].locationId;
    }
    const results = await searchProducts(query.trim(), locId, +limit);
    res.json({ locationId: locId, results });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// GET /api/products/locations — find nearby Kroger stores
router.get('/locations', async (req, res) => {
  const { zipCode = '60614', limit = 5 } = req.query;
  try {
    const locs = await findLocations(zipCode, +limit);
    res.json(locs);
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// GET /api/products
router.get('/', (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  const products = q
    ? db.prepare(`SELECT * FROM products WHERE name LIKE ? LIMIT ? OFFSET ?`)
        .all(`%${q}%`, +limit, +offset)
    : db.prepare(`SELECT * FROM products WHERE created_by = ? LIMIT ? OFFSET ?`)
        .all(req.user.userId, +limit, +offset);

  res.json(products.map(p => ({ ...p, prices: latestPrices(p.id) })));
});

// POST /api/products
router.post('/', (req, res) => {
  const { name, image_url, walmart_url, instacart_url, walmart_price, instacart_price } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const id = nanoid();
  db.prepare(`INSERT INTO products (id, name, image_url, walmart_url, instacart_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name.trim(), image_url ?? null, walmart_url ?? null, instacart_url ?? null, req.user.userId);

  if (walmart_price) {
    db.prepare('INSERT INTO price_snapshots (id, product_id, store, price) VALUES (?, ?, ?, ?)')
      .run(nanoid(), id, 'walmart', +walmart_price);
  }
  if (instacart_price) {
    db.prepare('INSERT INTO price_snapshots (id, product_id, store, price) VALUES (?, ?, ?, ?)')
      .run(nanoid(), id, 'instacart', +instacart_price);
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ ...product, prices: latestPrices(id) });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const history = db.prepare(
    `SELECT * FROM price_snapshots WHERE product_id = ? ORDER BY scraped_at DESC LIMIT 200`
  ).all(req.params.id);

  res.json({ ...product, prices: latestPrices(req.params.id), history });
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.userId);
  if (!product) return res.status(404).json({ error: 'Not found or not authorized' });

  const { name, image_url, walmart_url, instacart_url } = req.body;
  db.prepare(`UPDATE products SET
    name = COALESCE(?, name),
    image_url = COALESCE(?, image_url),
    walmart_url = COALESCE(?, walmart_url),
    instacart_url = COALESCE(?, instacart_url)
    WHERE id = ?`
  ).run(name ?? null, image_url ?? null, walmart_url ?? null, instacart_url ?? null, req.params.id);

  res.json({ ...db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id), prices: latestPrices(req.params.id) });
});

// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.userId);
  if (!product) return res.status(404).json({ error: 'Not found or not authorized' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/products/:id/refresh — re-query Kroger and save new price
// Body: { locationId?, zipCode? }
router.post('/:id/refresh', async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { locationId, zipCode = '60614' } = req.body ?? {};
  const results = {};

  try {
    // Resolve locationId
    let locId = locationId ?? product.walmart_url; // walmart_url field reused to store kroger locationId
    if (!locId || locId.startsWith('http')) {
      const locs = await findLocations(zipCode, 1);
      locId = locs[0]?.locationId;
    }

    if (locId) {
      const candidates = await searchProducts(product.name, locId, 5);
      // Match by kroger productId stored in instacart_url field (temp reuse), or just take first
      const match = candidates[0];
      if (match?.price) {
        db.prepare('INSERT INTO price_snapshots (id, product_id, store, price, in_stock) VALUES (?, ?, ?, ?, ?)')
          .run(nanoid(), product.id, 'kroger', match.price, 1);
        if (match.imageUrl && !product.image_url) {
          db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(match.imageUrl, product.id);
        }
        results.kroger = match;
      }
    }
  } catch (e) {
    results.kroger_error = e.message;
  }

  res.json({ ...results, prices: latestPrices(req.params.id) });
});

// POST /api/products/:id/price — manually add a price
router.post('/:id/price', (req, res) => {
  const { store, price } = req.body;
  const supportedStores = ['kroger', 'manual', 'aldi', 'costco', 'trader_joes', 'walmart', 'instacart'];
  if (!supportedStores.includes(store)) {
    return res.status(400).json({ error: 'Unsupported store/source' });
  }
  if (!price || isNaN(+price)) return res.status(400).json({ error: 'Valid price required' });

  db.prepare('INSERT INTO price_snapshots (id, product_id, store, price) VALUES (?, ?, ?, ?)')
    .run(nanoid(), req.params.id, store, +price);

  res.json({ ok: true, prices: latestPrices(req.params.id) });
});

export default router;
