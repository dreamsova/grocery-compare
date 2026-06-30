const USDA_API_KEY = normalizeApiKey(process.env.USDA_FDC_API_KEY);

export const usdaSource = {
  id: 'usda_fdc',
  label: 'USDA FoodData Central',
  kind: 'government_nutrition',
  role: 'Standardized nutrition reference data',
  trust: 'U.S. government open data',
  requiresKey: false,
  configured: true,
  credentialMode: USDA_API_KEY === 'DEMO_KEY' ? 'demo_key' : 'server_key',
};

export async function searchUsdaFoods(query, limit = 3) {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(limit));
  url.searchParams.set('api_key', USDA_API_KEY);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GroceryCompare/1.0 portfolio demo',
    },
  });
  if (!response.ok) throw new Error(`USDA FoodData Central returned HTTP ${response.status}`);

  const data = await response.json();
  return (data.foods || [])
    .slice(0, limit)
    .map(food => normalizeUsdaFood(food, query));
}

function normalizeUsdaFood(food, query) {
  const nutrients = food.foodNutrients || [];
  return {
    source: usdaSource.id,
    sourceLabel: usdaSource.label,
    sourceKind: usdaSource.kind,
    productName: titleCase(food.description || ''),
    brand: food.brandOwner || food.brandName || null,
    size: food.servingSize && food.servingSizeUnit ? `${food.servingSize}${food.servingSizeUnit}` : null,
    barcode: food.gtinUpc || null,
    imageUrl: null,
    productUrl: food.fdcId ? `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${food.fdcId}/nutrients` : null,
    nutrition: {
      calories: nutrientValue(nutrients, ['Energy']),
      protein: nutrientValue(nutrients, ['Protein']),
      carbs: nutrientValue(nutrients, ['Carbohydrate, by difference']),
      fat: nutrientValue(nutrients, ['Total lipid (fat)']),
      sugars: nutrientValue(nutrients, ['Sugars, total including NLEA', 'Sugars, total']),
      sodium: nutrientValue(nutrients, ['Sodium, Na']),
      basis: 'per USDA serving/reference',
    },
    badges: [food.dataType, food.foodCategory].filter(Boolean),
    categories: food.foodCategory || null,
    confidence: scoreMatch(query, food.description || ''),
    fetchedAt: new Date().toISOString(),
  };
}

function nutrientValue(nutrients, names) {
  const hit = nutrients.find(nutrient => names.includes(nutrient.nutrientName));
  const value = Number(hit?.value);
  return Number.isFinite(value) ? value : null;
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function scoreMatch(query, text) {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term.length >= 3);
  if (!terms.length) return 0.7;
  const haystack = text.toLowerCase();
  const hits = terms.filter(term => haystack.includes(term)).length;
  return Math.max(0.35, Math.min(0.95, hits / terms.length));
}

function normalizeApiKey(value) {
  const key = value?.trim();
  if (!key || key.startsWith('your-')) return 'DEMO_KEY';
  return key;
}
