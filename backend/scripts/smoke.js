const baseUrl = (process.env.SMOKE_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL || 'demo@grocerycompare.com';
const password = process.env.SMOKE_PASSWORD || 'demo1234';
const runCompare = process.env.SMOKE_COMPARE === 'true';

async function request(path, options = {}) {
  const res = await fetch(baseUrl + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed with ${res.status}: ${text}`);
  }
  return { res, body };
}

function accessCookieFrom(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookies = getSetCookie ? getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const combined = cookies.join('; ');
  const match = combined.match(/access_token=([^;]+)/);
  if (!match) throw new Error('Login did not return an access_token cookie');
  return `access_token=${match[1]}`;
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);

  const health = await request('/api/health');
  if (!health.body.ok) throw new Error('Health endpoint did not return ok=true');
  console.log('health ok');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const cookie = accessCookieFrom(login.res);
  console.log(`login ok: ${login.body.email}`);

  const lists = await request('/api/lists', { headers: { Cookie: cookie } });
  const ownedCount = lists.body.owned?.length ?? 0;
  if (ownedCount < 1) throw new Error('Expected at least one owned demo list');
  console.log(`lists ok: ${ownedCount} owned`);

  const sources = await request('/api/sources', { headers: { Cookie: cookie } });
  const sourceIds = (sources.body || []).map(source => source.id);
  for (const expected of ['kroger', 'community_prices', 'open_food_facts', 'usda_fdc']) {
    if (!sourceIds.includes(expected)) throw new Error(`Missing data source: ${expected}`);
  }
  console.log(`sources ok: ${sourceIds.join(', ')}`);

  if (runCompare) {
    const compare = await request('/api/compare', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({
        zipCode: '60614',
        items: [
          { name: 'eggs', qty: 1 },
          { name: 'whole milk', qty: 1 },
        ],
      }),
    });
    if (!compare.body.stores?.length) throw new Error('Compare returned no stores');
    console.log(`compare ok: ${compare.body.stores.length} stores`);
  } else {
    console.log('compare skipped; set SMOKE_COMPARE=true to include Kroger API check');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
