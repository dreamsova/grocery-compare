/**
 * POST /api/compare
 *
 * Search up to 5 nearby Kroger-family stores in parallel, return per-store totals.
 *
 * Body:
 *   items    Array<{ name: string, qty: number }>
 *   zipCode  string  (default "60614")
 *
 * Response:
 *   stores        Array<{ locationId, name, address, total, items, unmatched }>
 *   cheapestStore string  (name of cheapest store)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { compareKrogerStores } from '../dataSources/index.js';

const router = Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const { items, zipCode = '60614' } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'max 50 items per request' });
  }

  try {
    const result = await compareKrogerStores(items, zipCode, 5);
    if (!result.stores.length) {
      return res.status(404).json({ error: `No Kroger stores found near ${zipCode}` });
    }

    res.json({
      source: result.source,
      stores: result.stores,
      cheapestStore: result.cheapestStore,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
