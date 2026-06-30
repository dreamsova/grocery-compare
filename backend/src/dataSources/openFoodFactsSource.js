export const openFoodFactsSource = {
  id: 'open_food_facts',
  label: 'Open Food Facts',
  kind: 'open_product_catalog',
  role: 'Product metadata, package photos, nutrition labels',
  trust: 'Open community database',
  requiresKey: false,
  configured: true,
};

const OPEN_FOOD_FACTS_FIELDS = [
  'product_name',
  'brands',
  'image_url',
  'quantity',
  'nutriscore_grade',
  'nova_group',
  'nutriments',
  'categories',
  'labels',
  'code',
  'url',
].join(',');

export async function searchOpenFoodFacts(query, limit = 3) {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('search_terms', query);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', String(limit));
  url.searchParams.set('fields', OPEN_FOOD_FACTS_FIELDS);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GroceryCompare/1.0 (portfolio demo; contact: demo@example.com)',
    },
  });
  if (!response.ok) throw new Error(`Open Food Facts returned HTTP ${response.status}`);

  const data = await response.json();
  return (data.products || [])
    .filter(product => product.product_name)
    .slice(0, limit)
    .map(product => normalizeOpenFoodFactsProduct(product, query));
}

function normalizeOpenFoodFactsProduct(product, query) {
  return {
    source: openFoodFactsSource.id,
    sourceLabel: openFoodFactsSource.label,
    sourceKind: openFoodFactsSource.kind,
    productName: product.product_name,
    brand: firstValue(product.brands),
    size: product.quantity || null,
    barcode: product.code || null,
    imageUrl: product.image_url || null,
    productUrl: product.url || null,
    nutrition: normalizeNutrition(product.nutriments || {}),
    badges: [
      knownValue(product.nutriscore_grade) ? `Nutri-Score ${String(product.nutriscore_grade).toUpperCase()}` : null,
      product.nova_group ? `NOVA ${product.nova_group}` : null,
      firstValue(product.labels),
    ].filter(Boolean),
    categories: product.categories || null,
    confidence: scoreMatch(query, [product.product_name, product.brands, product.quantity].filter(Boolean).join(' ')),
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeNutrition(nutriments) {
  return {
    calories: numberOrNull(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal_serving']),
    protein: numberOrNull(nutriments.proteins_100g ?? nutriments.proteins_serving),
    carbs: numberOrNull(nutriments.carbohydrates_100g ?? nutriments.carbohydrates_serving),
    fat: numberOrNull(nutriments.fat_100g ?? nutriments.fat_serving),
    sugars: numberOrNull(nutriments.sugars_100g ?? nutriments.sugars_serving),
    sodium: gramsToMilligrams(nutriments.sodium_100g ?? nutriments.sodium_serving),
    basis: nutriments['energy-kcal_100g'] ? 'per 100g' : 'per serving',
  };
}

function firstValue(value) {
  if (!value) return null;
  return String(value).split(',').map(item => item.trim()).filter(Boolean)[0] || null;
}

function knownValue(value) {
  return value && !['unknown', 'not-applicable'].includes(String(value).toLowerCase());
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function gramsToMilligrams(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) : null;
}

function scoreMatch(query, text) {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term.length >= 3);
  if (!terms.length) return 0.7;
  const haystack = text.toLowerCase();
  const hits = terms.filter(term => haystack.includes(term)).length;
  return Math.max(0.35, Math.min(0.95, hits / terms.length));
}
