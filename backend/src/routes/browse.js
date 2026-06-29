/**
 * GET /api/browse/categories  — hardcoded category list (no Kroger call)
 * GET /api/browse/trending    — prices for 12 popular items (requires auth)
 * GET /api/browse/category/:slug — products for a category (requires auth)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { findLocations, searchProducts } from '../kroger.js';

const router = Router();

const CATEGORIES = [
  { slug: 'produce',   label: 'Produce',    emoji: '🥬', color: '#16a34a', bg: '#f0fdf4' },
  { slug: 'dairy',     label: 'Dairy',      emoji: '🥛', color: '#2563eb', bg: '#eff6ff' },
  { slug: 'meat',      label: 'Meat',       emoji: '🥩', color: '#dc2626', bg: '#fef2f2' },
  { slug: 'bakery',    label: 'Bakery',     emoji: '🍞', color: '#d97706', bg: '#fffbeb' },
  { slug: 'frozen',    label: 'Frozen',     emoji: '🧊', color: '#0891b2', bg: '#ecfeff' },
  { slug: 'beverages', label: 'Beverages',  emoji: '🥤', color: '#7c3aed', bg: '#f5f3ff' },
  { slug: 'snacks',    label: 'Snacks',     emoji: '🍿', color: '#c2410c', bg: '#fff7ed' },
  { slug: 'pantry',    label: 'Pantry',     emoji: '🫙', color: '#57534e', bg: '#fafaf9' },
];

const TRENDING_ITEMS = [
  'eggs', 'whole milk', 'bread', 'chicken breast', 'bananas', 'yogurt',
  'butter', 'orange juice', 'cheddar cheese', 'ground beef', 'pasta', 'rice',
];

const CATEGORY_SEARCH_MAP = {
  produce:   'fresh vegetables',
  dairy:     'milk yogurt',
  meat:      'chicken beef',
  bakery:    'bread',
  frozen:    'frozen meals',
  beverages: 'juice soda water',
  snacks:    'chips crackers',
  pantry:    'pasta rice canned',
};

// GET /api/browse/categories
router.get('/categories', (_req, res) => {
  res.json(CATEGORIES);
});

// GET /api/browse/trending?zipCode=60614
router.get('/trending', requireAuth, async (req, res) => {
  const zipCode = req.query.zipCode || '60614';

  try {
    const locations = await findLocations(zipCode, 1);
    if (!locations.length) {
      return res.status(404).json({ error: `No Kroger stores found near ${zipCode}` });
    }
    const location = locations[0];

    const searches = TRENDING_ITEMS.map(term =>
      searchProducts(term, location.locationId, 1)
        .then(results => {
          if (!results.length) return null;
          const p = results[0];
          // Determine a rough category from the search term
          const category = guessCategory(term);
          return {
            name: p.name,
            brand: p.brand,
            price: p.price,
            imageUrl: p.imageUrl,
            size: p.size,
            productId: p.productId,
            category,
          };
        })
        .catch(() => null)
    );

    const results = (await Promise.all(searches)).filter(Boolean);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/browse/category/:slug?zipCode=60614
router.get('/category/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const zipCode = req.query.zipCode || '60614';
  const searchTerm = CATEGORY_SEARCH_MAP[slug];

  if (!searchTerm) {
    return res.status(404).json({ error: `Unknown category: ${slug}` });
  }

  try {
    const locations = await findLocations(zipCode, 1);
    if (!locations.length) {
      return res.status(404).json({ error: `No Kroger stores found near ${zipCode}` });
    }
    const location = locations[0];

    const results = await searchProducts(searchTerm, location.locationId, 8);
    const products = results.map(p => ({
      name: p.name,
      brand: p.brand,
      price: p.price,
      imageUrl: p.imageUrl,
      size: p.size,
      productId: p.productId,
      category: slug,
    }));

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function guessCategory(term) {
  if (['eggs', 'whole milk', 'yogurt', 'butter', 'cheddar cheese'].includes(term)) return 'dairy';
  if (['chicken breast', 'ground beef'].includes(term)) return 'meat';
  if (['bread'].includes(term)) return 'bakery';
  if (['bananas'].includes(term)) return 'produce';
  if (['orange juice'].includes(term)) return 'beverages';
  if (['pasta', 'rice'].includes(term)) return 'pantry';
  return 'pantry';
}

export default router;
