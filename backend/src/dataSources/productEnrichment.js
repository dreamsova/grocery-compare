import { krogerSource } from './krogerSource.js';
import { openFoodFactsSource, searchOpenFoodFacts } from './openFoodFactsSource.js';
import { usdaSource, searchUsdaFoods } from './usdaSource.js';

export function dataSourceCatalog() {
  return [
    {
      ...krogerSource,
      role: 'Live local price search and nearby store comparison',
      trust: 'Official retailer API',
      requiresKey: true,
      configured: Boolean(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET),
    },
    {
      id: 'community_prices',
      label: 'Community / Receipt Prices',
      kind: 'receipt_or_manual',
      role: 'Costco, Trader Joe’s, Aldi, and other stores without public APIs',
      trust: 'User-submitted evidence with confidence scoring',
      requiresKey: false,
      configured: true,
    },
    openFoodFactsSource,
    usdaSource,
  ];
}

export async function enrichProductFromSources(product, options = {}) {
  return enrichQueryFromSources(product.name, options, {
    productId: product.id,
    existingImageUrl: product.image_url,
  });
}

export async function enrichQueryFromSources(query, options = {}, context = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 3, 8));
  const tasks = [
    runSource(openFoodFactsSource, () => searchOpenFoodFacts(query, limit)),
    runSource(usdaSource, () => searchUsdaFoods(query, limit)),
  ];

  const sources = await Promise.all(tasks);
  const matches = sources.flatMap(source => source.matches || []);
  const bestOpenProduct = bestMatch(matches, 'open_food_facts');
  const bestNutrition = bestNutritionMatch(matches);

  return {
    productId: context.productId ?? null,
    query,
    fetchedAt: new Date().toISOString(),
    sources,
    summary: {
      brand: bestOpenProduct?.brand || bestNutrition?.brand || null,
      size: bestOpenProduct?.size || bestNutrition?.size || null,
      barcode: bestOpenProduct?.barcode || bestNutrition?.barcode || null,
      imageUrl: context.existingImageUrl || bestOpenProduct?.imageUrl || null,
      nutrition: bestNutrition?.nutrition || null,
      nutritionSource: bestNutrition?.sourceLabel || null,
      badges: Array.from(new Set(matches.flatMap(match => match.badges || []).filter(Boolean))).slice(0, 6),
      bestMatchConfidence: Math.max(0, ...matches.map(match => Number(match.confidence) || 0)),
    },
  };
}

async function runSource(source, searchFn) {
  try {
    const matches = await searchFn();
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      role: source.role,
      trust: source.trust,
      status: matches.length ? 'ok' : 'empty',
      matches,
    };
  } catch (error) {
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      role: source.role,
      trust: source.trust,
      status: 'error',
      error: error.message,
      matches: [],
    };
  }
}

function bestMatch(matches, sourceId) {
  return matches
    .filter(match => match.source === sourceId)
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))[0] || null;
}

function bestNutritionMatch(matches) {
  return matches
    .filter(match => hasNutrition(match.nutrition))
    .sort((a, b) => {
      const sourceRank = rankNutritionSource(b.source) - rankNutritionSource(a.source);
      if (sourceRank) return sourceRank;
      return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    })[0] || null;
}

function hasNutrition(nutrition) {
  if (!nutrition) return false;
  return ['calories', 'protein', 'carbs', 'fat', 'sugars', 'sodium']
    .some(field => nutrition[field] !== null && nutrition[field] !== undefined);
}

function rankNutritionSource(source) {
  if (source === 'usda_fdc') return 2;
  if (source === 'open_food_facts') return 1;
  return 0;
}
