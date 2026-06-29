/**
 * Kroger API client
 *
 * Covers Kroger-family stores: Jewel-Osco, Mariano's, Kroger, Fred Meyer, etc.
 * Docs: https://developer.kroger.com/api-products/api/product-api-ce
 *
 * Auth: Client Credentials flow — token lasts 30 min, auto-refreshed.
 * Prices require a locationId — always pass one.
 */

const BASE = 'https://api.kroger.com/v1';
const CLIENT_ID = process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;

// ── Token cache ────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'product.compact' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger auth failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

// ── Locations ──────────────────────────────────────────────────────

/**
 * Find nearby Kroger-family store locations.
 *
 * @param {string} zipCode   e.g. "60614"
 * @param {number} limit     max locations to return (default 5)
 * @param {string} chain     optional chain filter e.g. "Jewel-Osco"
 * @returns {Array<{locationId, name, chain, address, distance}>}
 */
export async function findLocations(zipCode, limit = 5, chain = null) {
  const token = await getToken();
  const params = new URLSearchParams({
    'filter.zipCode.near': zipCode,
    'filter.limit': String(limit),
    'filter.radiusInMiles': '10',
  });
  if (chain) params.set('filter.chain', chain);

  const res = await fetch(`${BASE}/locations?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Kroger locations failed (${res.status})`);

  const json = await res.json();
  return (json.data ?? []).map(loc => ({
    locationId: loc.locationId,
    name: loc.name,
    chain: loc.chain,
    address: `${loc.address?.addressLine1}, ${loc.address?.city}, ${loc.address?.state} ${loc.address?.zipCode}`,
    distance: loc.geolocation?.latLng ? null : null, // Kroger doesn't return distance directly
  }));
}

// ── Products ───────────────────────────────────────────────────────

/**
 * Search for products at a specific Kroger store.
 *
 * @param {string} query       search term e.g. "eggs 18ct"
 * @param {string} locationId  Kroger store location ID
 * @param {number} limit       max results (default 5, max 50)
 * @returns {Array<{name, brand, price, pricePerUnit, size, imageUrl, productId, url}>}
 */
export async function searchProducts(query, locationId, limit = 5) {
  const token = await getToken();
  // Strip quantity tokens (e.g. "18ct", "2lb", "1gal", "12oz") so Kroger search works better
  const searchTerm = query.replace(/\b\d+\s*(ct|lb|oz|gal|kg|g|ml|l|pk|pack|count)\b/gi, '').trim();
  const params = new URLSearchParams({
    'filter.term': searchTerm,
    'filter.locationId': locationId,
    'filter.limit': '10',
    'filter.fulfillment': 'ais',
  });

  const res = await fetch(`${BASE}/products?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kroger product search failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const all = (json.data ?? []).map(parseProduct).filter(Boolean);

  // Extract meaningful keywords (drop pure numbers, quantity suffixes like "18ct" "2lb" "1gal")
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => /^[a-z]{3,}$/.test(w) && !['and','the','with','for','of','size','pack','per'].includes(w));

  // Keep products whose name contains ALL keywords (fall back to ANY, then to none)
  const nameOf = p => p.name.toLowerCase();
  let filtered = all.filter(p => keywords.every(kw => nameOf(p).includes(kw)));
  if (!filtered.length) filtered = all.filter(p => keywords.some(kw => nameOf(p).includes(kw)));
  if (!filtered.length) filtered = all;

  filtered.sort((a, b) => a.price - b.price);
  return filtered.slice(0, limit);
}

// ── Parser ─────────────────────────────────────────────────────────

function parseProduct(p) {
  try {
    const items = p.items ?? [];
    // Pick the first item that has price info
    const item = items.find(i => i.price?.regular != null) ?? items[0];
    if (!item) return null;

    const price = item.price?.promo ?? item.price?.regular;
    if (price == null) return null;

    const imageUrl =
      p.images?.find(img => img.perspective === 'front')?.sizes?.find(s => s.size === 'medium')?.url ??
      p.images?.[0]?.sizes?.[0]?.url ??
      null;

    return {
      name: p.description,
      brand: p.brand ?? null,
      price: parseFloat(price),
      pricePerUnit: item.price?.unitOfMeasure
        ? `$${item.price.regular}/${item.price.unitOfMeasure}`
        : null,
      size: item.size ?? null,
      imageUrl,
      productId: p.productId,
      url: `https://www.kroger.com/p/${p.productId}`,
    };
  } catch {
    return null;
  }
}
