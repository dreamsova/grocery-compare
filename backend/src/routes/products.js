import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { searchProducts, findLocations } from '../kroger.js';
import { enrichProductFromSources } from '../dataSources/index.js';

const router = Router();
router.use(requireAuth);

const PRICE_FIELDS = `
  price,
  scraped_at,
  store,
  source_label,
  source_kind,
  confidence,
  evidence_note,
  submitted_at
`;

const SOURCE_META = {
  kroger: { label: 'Kroger Product API', kind: 'official_api', confidence: 0.98 },
  manual: { label: 'Manual community price', kind: 'manual', confidence: 0.7 },
  aldi: { label: 'Aldi community price', kind: 'manual', confidence: 0.7 },
  costco: { label: 'Costco community price', kind: 'manual', confidence: 0.7 },
  trader_joes: { label: "Trader Joe's community price", kind: 'manual', confidence: 0.7 },
  walmart: { label: 'Legacy Walmart price', kind: 'legacy', confidence: 0.55 },
  instacart: { label: 'Legacy Instacart price', kind: 'legacy', confidence: 0.55 },
};

function sourceLabel(store) {
  return SOURCE_META[store]?.label ?? store;
}

function normalizeSourceKind(store, requestedKind) {
  if (store === 'kroger') return 'official_api';
  if (requestedKind === 'receipt_verified') return 'receipt_verified';
  if (requestedKind === 'manual') return 'manual';
  return SOURCE_META[store]?.kind ?? 'manual';
}

function confidenceFor(kind, store) {
  if (kind === 'official_api') return 0.98;
  if (kind === 'receipt_verified') return 0.9;
  if (kind === 'manual') return 0.7;
  return SOURCE_META[store]?.confidence ?? 0.7;
}

function insertPriceSnapshot({
  productId,
  store,
  price,
  sourceKind,
  evidenceNote = null,
  submittedBy = null,
  inStock = 1,
}) {
  const normalizedKind = normalizeSourceKind(store, sourceKind);
  db.prepare(`INSERT INTO price_snapshots
    (id, product_id, store, price, in_stock, source_label, source_kind, confidence, evidence_note, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    nanoid(),
    productId,
    store,
    +price,
    inStock,
    sourceLabel(store),
    normalizedKind,
    confidenceFor(normalizedKind, store),
    evidenceNote,
    submittedBy,
  );
}

function latestPriceFor(productId, store) {
  return db.prepare(
    `SELECT ${PRICE_FIELDS} FROM price_snapshots
     WHERE product_id = ? AND store = ? ORDER BY scraped_at DESC LIMIT 1`
  ).get(productId, store) ?? null;
}

function latestPrices(productId) {
  return {
    kroger: latestPriceFor(productId, 'kroger'),
    community: db.prepare(
      `SELECT ${PRICE_FIELDS} FROM price_snapshots
       WHERE product_id = ?
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1`
    ).get(productId) ?? null,
    walmart: latestPriceFor(productId, 'walmart'),
    instacart: latestPriceFor(productId, 'instacart'),
  };
}

function serializeProduct(product) {
  if (!product) return null;
  return {
    ...product,
    nutrition: parseJson(product.nutrition_json),
    external_sources: parseJson(product.external_sources_json) || [],
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

  res.json(products.map(p => ({ ...serializeProduct(p), prices: latestPrices(p.id) })));
});

// POST /api/products
router.post('/', (req, res) => {
  const {
    name,
    image_url,
    walmart_url,
    instacart_url,
    walmart_price,
    instacart_price,
    brand,
    size,
    barcode,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const cleanName = name.trim();
  const existing = db.prepare('SELECT * FROM products WHERE name = ? AND created_by = ?')
    .get(cleanName, req.user.userId);
  if (existing) {
    db.prepare(`UPDATE products SET
      image_url = COALESCE(image_url, ?),
      walmart_url = COALESCE(walmart_url, ?),
      instacart_url = COALESCE(instacart_url, ?),
      brand = COALESCE(brand, ?),
      size = COALESCE(size, ?),
      barcode = COALESCE(barcode, ?)
      WHERE id = ?`
    ).run(
      image_url ?? null,
      walmart_url ?? null,
      instacart_url ?? null,
      brand?.trim() || null,
      size?.trim() || null,
      barcode?.trim() || null,
      existing.id,
    );

    if (walmart_price) {
      insertPriceSnapshot({
        productId: existing.id,
        store: 'walmart',
        price: walmart_price,
        sourceKind: 'legacy',
        submittedBy: req.user.userId,
      });
    }
    if (instacart_price) {
      insertPriceSnapshot({
        productId: existing.id,
        store: 'instacart',
        price: instacart_price,
        sourceKind: 'legacy',
        submittedBy: req.user.userId,
      });
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
    return res.json({ ...serializeProduct(product), prices: latestPrices(existing.id) });
  }

  const id = nanoid();
  db.prepare(`INSERT INTO products
    (id, name, image_url, walmart_url, instacart_url, created_by, brand, size, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    cleanName,
    image_url ?? null,
    walmart_url ?? null,
    instacart_url ?? null,
    req.user.userId,
    brand?.trim() || null,
    size?.trim() || null,
    barcode?.trim() || null,
  );

  if (walmart_price) {
    insertPriceSnapshot({
      productId: id,
      store: 'walmart',
      price: walmart_price,
      sourceKind: 'legacy',
      submittedBy: req.user.userId,
    });
  }
  if (instacart_price) {
    insertPriceSnapshot({
      productId: id,
      store: 'instacart',
      price: instacart_price,
      sourceKind: 'legacy',
      submittedBy: req.user.userId,
    });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json({ ...serializeProduct(product), prices: latestPrices(id) });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const history = db.prepare(
    `SELECT * FROM price_snapshots WHERE product_id = ? ORDER BY scraped_at DESC LIMIT 200`
  ).all(req.params.id);

  res.json({ ...serializeProduct(product), prices: latestPrices(req.params.id), history });
});

// POST /api/products/:id/enrich — fetch product metadata from open data sources
router.post('/:id/enrich', async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const enrichment = await enrichProductFromSources(product, { limit: req.body?.limit || 3 });
  const summary = enrichment.summary || {};
  const nutritionJson = summary.nutrition ? JSON.stringify(summary.nutrition) : product.nutrition_json;
  const sourcesJson = JSON.stringify(enrichment.sources || []);
  const hasFreshSourceResponse = (enrichment.sources || [])
    .some(source => source.status === 'ok' || source.status === 'empty');

  db.prepare(`UPDATE products SET
    brand = COALESCE(brand, ?),
    size = COALESCE(size, ?),
    barcode = COALESCE(barcode, ?),
    image_url = COALESCE(image_url, ?),
    nutrition_json = COALESCE(?, nutrition_json),
    external_sources_json = ?,
    enriched_at = CASE WHEN ? THEN datetime('now') ELSE enriched_at END
    WHERE id = ?`
  ).run(
    summary.brand || null,
    summary.size || null,
    summary.barcode || null,
    summary.imageUrl || null,
    nutritionJson || null,
    sourcesJson,
    hasFreshSourceResponse ? 1 : 0,
    req.params.id,
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json({
    product: { ...serializeProduct(updated), prices: latestPrices(req.params.id) },
    enrichment,
  });
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.userId);
  if (!product) return res.status(404).json({ error: 'Not found or not authorized' });

  const { name, image_url, walmart_url, instacart_url, brand, size, barcode } = req.body;
  db.prepare(`UPDATE products SET
    name = COALESCE(?, name),
    image_url = COALESCE(?, image_url),
    walmart_url = COALESCE(?, walmart_url),
    instacart_url = COALESCE(?, instacart_url),
    brand = COALESCE(?, brand),
    size = COALESCE(?, size),
    barcode = COALESCE(?, barcode)
    WHERE id = ?`
  ).run(
    name ?? null,
    image_url ?? null,
    walmart_url ?? null,
    instacart_url ?? null,
    brand ?? null,
    size ?? null,
    barcode ?? null,
    req.params.id,
  );

  res.json({
    ...serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)),
    prices: latestPrices(req.params.id),
  });
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
        insertPriceSnapshot({
          productId: product.id,
          store: 'kroger',
          price: match.price,
          sourceKind: 'official_api',
          inStock: 1,
        });
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
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { store, price, source_kind, evidence_note } = req.body;
  const supportedStores = ['kroger', 'manual', 'aldi', 'costco', 'trader_joes', 'walmart', 'instacart'];
  if (!supportedStores.includes(store)) {
    return res.status(400).json({ error: 'Unsupported store/source' });
  }
  const supportedKinds = ['manual', 'receipt_verified', 'official_api', 'legacy'];
  if (source_kind && !supportedKinds.includes(source_kind)) {
    return res.status(400).json({ error: 'Unsupported source kind' });
  }
  if (!price || isNaN(+price)) return res.status(400).json({ error: 'Valid price required' });

  insertPriceSnapshot({
    productId: req.params.id,
    store,
    price,
    sourceKind: source_kind,
    evidenceNote: evidence_note?.trim() || null,
    submittedBy: req.user.userId,
  });

  res.json({ ok: true, prices: latestPrices(req.params.id) });
});

export default router;
