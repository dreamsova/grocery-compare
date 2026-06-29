import { findLocations, searchProducts } from '../kroger.js';

export const krogerSource = {
  id: 'kroger',
  label: 'Kroger-family stores',
  kind: 'official_api',
};

export async function searchKrogerSource(query, locationId, limit = 5) {
  const products = await searchProducts(query, locationId, limit);
  return products.map(product => ({
    source: krogerSource.id,
    sourceLabel: krogerSource.label,
    sourceKind: krogerSource.kind,
    storeName: 'Kroger-family store',
    productName: product.name,
    brand: product.brand,
    price: product.price,
    unitPrice: product.pricePerUnit,
    size: product.size,
    imageUrl: product.imageUrl,
    productUrl: product.url,
    externalId: product.productId,
    confidence: scoreMatch(query, product.name),
    fetchedAt: new Date().toISOString(),
  }));
}

export async function compareKrogerStores(items, zipCode = '60614', storeLimit = 5) {
  const locations = await findLocations(zipCode, storeLimit);
  const stores = await Promise.all(locations.map(store => priceStore(store, items)));
  stores.sort((a, b) => a.total - b.total);
  return {
    source: krogerSource,
    stores,
    cheapestStore: stores[0]?.name ?? null,
  };
}

async function priceStore(store, items) {
  const searchResults = await Promise.all(items.map(({ name, qty = 1 }) =>
    searchKrogerSource(name, store.locationId, 4)
      .then(results => ({ searched: name, qty: +qty || 1, results }))
      .catch(() => ({ searched: name, qty: +qty || 1, results: [] }))
  ));

  const matched = [];
  const unmatched = [];
  let total = 0;

  for (const { searched, qty, results } of searchResults) {
    if (!results.length) {
      unmatched.push(searched);
      continue;
    }

    const best = results[0];
    const lineTotal = parseFloat((best.price * qty).toFixed(2));
    total += lineTotal;
    matched.push({
      searched,
      qty,
      matched: best.productName,
      brand: best.brand,
      price: best.price,
      lineTotal,
      imageUrl: best.imageUrl,
      size: best.size,
      confidence: best.confidence,
      source: best.source,
      sourceKind: best.sourceKind,
      fetchedAt: best.fetchedAt,
      alternatives: results.slice(1),
    });
  }

  return {
    source: krogerSource.id,
    sourceKind: krogerSource.kind,
    locationId: store.locationId,
    name: store.name,
    chain: store.chain,
    address: store.address,
    total: parseFloat(total.toFixed(2)),
    items: matched,
    unmatched,
  };
}

function scoreMatch(query, productName) {
  const terms = query.toLowerCase().split(/\s+/).filter(term => /^[a-z]{3,}$/.test(term));
  if (!terms.length) return 0.75;

  const name = productName.toLowerCase();
  const hits = terms.filter(term => name.includes(term)).length;
  return Math.max(0.4, Math.min(0.98, hits / terms.length));
}
