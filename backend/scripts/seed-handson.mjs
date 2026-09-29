// HANDS-ON SEED DATA for the OWNER's manual browser testing of location/at-billing pricing (rules
// 111/113) — creates two articles, stock at two locations, a party, and three PACKED orders
// through the real API. TEST DATABASE ONLY — see the refusal check immediately below, which runs
// before this file makes a single request.
//
// This is NOT a test file: it makes no assertions and has no pass/fail count. It exists purely to
// put realistic, clickable data in front of the owner so BillOrderDetail.jsx and dashboard/
// Orders.jsx's "Mark billed" modal can be exercised by hand — the two screens this branch's
// frontend task changed to price from GET /api/orders/:id/fulfillment-preview instead of
// priceAtOrder.
//
// IDEMPOTENT BY NAME, deliberately, unlike the test-*.mjs files' `${stamp}`-suffixed names: this
// script is meant to be run again and again as the owner bills through the orders it made last
// time, so every REFERENCE entity (the two locations, the factory, the category, both articles,
// all four colours, the party) is found-or-created by its fixed name below rather than minted
// fresh each run. Only the ORDERS are always newly created — running this again is exactly how the
// owner gets a fresh batch of three PACKED orders after billing the last batch.
//
// Talks to the real running test server at http://localhost:3002 as owner/owner1234 with PIN
// 123456, through the same api()/login() shape every backend/test-*.mjs file already uses — real
// code paths, not a direct Prisma write, so every rule those endpoints enforce (PIN gates, the
// sellingPrice > 0 check, articleNo uniqueness per Factory, party state) applies here too.
//
// WHAT THIS SCRIPT DOES NOT DO: it never imports @prisma/client and never reads or writes
// DATABASE_URL. It has nothing to guard by overriding that variable the way the test files do,
// because it makes no direct database query of its own — every effect goes through the HTTP API.
// The one thing it DOES check, below, is that the shell environment's own TEST_DATABASE_URL points
// at the TEST branch, as the best available proxy for "the server this script is about to talk to
// was itself started against TEST" — it cannot verify that directly, since the running server's own
// environment is a separate process this script has no visibility into. Starting the server
// correctly (TEST_DATABASE_URL, `npm run start:test`) remains the owner's responsibility.

const dotenv = await import('dotenv');
dotenv.config({ quiet: true });

// --- SAFETY CHECK — the first thing this file does, before any HTTP request of any kind --------
// Deliberately reads ONLY process.env.TEST_DATABASE_URL, never DATABASE_URL (which this repo's own
// .env currently points at Preview, ep-long-frost) and never falls back to it. A script that seeds
// sample orders and prices has no business running against anything but a disposable database.
const rawTestUrl = process.env.TEST_DATABASE_URL;
if (!rawTestUrl) {
  console.error(
    'Refusing to run: TEST_DATABASE_URL is not set. This script must never guess which database ' +
      'it is pointed at — export TEST_DATABASE_URL (the TEST branch\'s connection string) first.'
  );
  process.exit(1);
}
let testHost;
try {
  testHost = new URL(rawTestUrl).hostname;
} catch {
  console.error(`Refusing to run: TEST_DATABASE_URL is set but is not a valid URL: ${rawTestUrl}`);
  process.exit(1);
}
console.log(`TEST_DATABASE_URL host: ${testHost}`);
if (!testHost.includes('ep-round-wind')) {
  console.error(
    `Refusing to run: TEST_DATABASE_URL's host is "${testHost}", which does not contain ` +
      '"ep-round-wind" — the TEST branch\'s known host. This must be impossible to point at ' +
      'Preview (ep-long-frost) or Production (ep-mute-cake), even by accident.'
  );
  process.exit(1);
}
console.log('Host check passed — this is the TEST branch. Proceeding.\n');

const BASE = 'http://localhost:3002';
const OWNER_PIN = '123456';

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no body — fine for some responses
  }
  return { status: res.status, body: json };
}

async function login(username, password) {
  const { status, body } = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  if (status !== 200 || !body?.token) {
    throw new Error(
      `Login failed for "${username}" — status ${status}, body ${JSON.stringify(body)}. ` +
        'Is the test server running (npm run start:test) and reachable at ' + BASE + '?'
    );
  }
  return body.token;
}

// Shared shape for every "reuse by name, else create" entity below (Factory, Category, Location,
// Party) — all four expose an identical GET-list/POST-create pair and the identical case-
// insensitive-uniqueness behaviour server-side, so one function covers all four rather than four
// near-identical copies that could drift on a future edit to any one of them.
async function findOrCreate(token, { label, listPath, createPath, matchName, createBody }) {
  const list = await api(listPath, { token });
  if (!Array.isArray(list.body)) {
    throw new Error(`${label}: could not list via ${listPath} — ${JSON.stringify(list.body)}`);
  }
  const existing = list.body.find((row) => row.name?.toLowerCase() === matchName.toLowerCase());
  if (existing) {
    console.log(`  ${label} "${matchName}": reusing existing (${existing.id})`);
    return existing.id;
  }
  const created = await api(createPath, { method: 'POST', token, body: createBody });
  if (!created.body?.id) {
    throw new Error(`${label}: creation failed — ${JSON.stringify(created.body)}`);
  }
  console.log(`  ${label} "${matchName}": created (${created.body.id})`);
  return created.body.id;
}

// Product is its own function, not folded into findOrCreate above: article numbers are unique only
// per Factory (CLAUDE.md's non-negotiable rule), so the match has to be scoped to factoryId too,
// and creation needs the PIN + sizes/cost/selling fields findOrCreate's generic body doesn't carry.
// Only sets costPrice/sellingPrice at CREATION time — if the article already exists from a
// previous run, its base price is trusted as-is rather than silently overwritten by this script.
async function findOrCreateProduct(token, { articleNo, name, factoryId, categoryId, costPrice, sellingPrice }) {
  const list = await api(`/api/products?articleNo=${encodeURIComponent(articleNo)}`, { token });
  if (!Array.isArray(list.body)) {
    throw new Error(`Product ${articleNo}: could not list — ${JSON.stringify(list.body)}`);
  }
  // GET /api/products?articleNo= is a case-insensitive CONTAINS match server-side (productController
  // .js's listProducts), so a broader match (e.g. a future "HANDS-A2") could come back alongside the
  // exact one — filtered to an exact, same-Factory match here rather than trusting the first result.
  const existing = list.body.find(
    (p) => p.articleNo.toLowerCase() === articleNo.toLowerCase() && p.factoryId === factoryId
  );
  if (existing) {
    console.log(`  Article ${articleNo}: reusing existing (${existing.id})`);
    return existing.id;
  }
  const created = await api('/api/products', {
    method: 'POST',
    token,
    body: {
      articleNo,
      factoryId,
      name,
      categoryId,
      isKids: false,
      // One size, qty 1 — piecesPerSet is exactly 1, so every price printed in this script's
      // summary is both the per-set AND the per-piece figure, with nothing to convert between them
      // when the owner compares what's on screen to what's printed here.
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
      costPrice,
      sellingPrice,
      pin: OWNER_PIN,
    },
  });
  if (!created.body?.id) {
    throw new Error(`Article ${articleNo}: creation failed — ${JSON.stringify(created.body)}`);
  }
  console.log(`  Article ${articleNo}: created (${created.body.id})`);
  return created.body.id;
}

// Bundle find-or-create: GET /api/bundles?productId= returns { id, productId, colorId } rows with
// no name-based lookup available (colours are matched by id, not name, at this layer), so this
// lists the product's existing bundles and matches on colorId directly rather than reusing
// findOrCreate's name-matching shape.
async function findOrCreateBundle(token, productId, colorId, colorLabel) {
  const list = await api(`/api/bundles?productId=${productId}`, { token });
  if (!Array.isArray(list.body)) {
    throw new Error(`Bundle for ${colorLabel}: could not list — ${JSON.stringify(list.body)}`);
  }
  const existing = list.body.find((b) => b.colorId === colorId);
  if (existing) {
    console.log(`    bundle (${colorLabel}): reusing existing (${existing.id})`);
    return existing.id;
  }
  const created = await api('/api/bundles', { method: 'POST', token, body: { productId, colorId } });
  if (!created.body?.id) {
    throw new Error(`Bundle for ${colorLabel}: creation failed — ${JSON.stringify(created.body)}`);
  }
  console.log(`    bundle (${colorLabel}): created (${created.body.id})`);
  return created.body.id;
}

// Tops a bundle's stock at one location up to AT LEAST minQty, never down — this script is re-run
// repeatedly across many manual billing sessions, and a PACKED order (unlike a BILLED one) deducts
// nothing, so stock only ever falls when the owner actually bills from this location. Reading
// current stock first, rather than always STOCK_IN-ing the full minQty, keeps repeated runs from
// piling up unbounded quantities on a location nobody billed from since the last run.
async function ensureStock(token, bundleId, locationId, locationLabel, minQty) {
  const rows = await api(`/api/stock?locationId=${locationId}`, { token });
  if (!Array.isArray(rows.body)) {
    throw new Error(`Stock check at ${locationLabel}: could not list — ${JSON.stringify(rows.body)}`);
  }
  const current = rows.body.find((r) => r.bundleId === bundleId)?.qtySets ?? 0;
  if (current >= minQty) {
    console.log(`    stock at ${locationLabel}: already ${current} sets (>= ${minQty}), leaving as-is`);
    return;
  }
  const topUp = minQty - current;
  const r = await api('/api/transactions', {
    method: 'POST',
    token,
    body: { bundleId, locationId, type: 'STOCK_IN', qtySets: topUp },
  });
  if (r.status !== 201) {
    throw new Error(`Stock-in at ${locationLabel} failed: ${JSON.stringify(r.body)}`);
  }
  console.log(`    stock at ${locationLabel}: ${current} -> ${current + topUp} sets (+${topUp})`);
}

async function setLocationPrice(token, productId, locationId, sellingPrice) {
  const r = await api(`/api/products/${productId}/location-prices/${locationId}`, {
    method: 'PUT',
    token,
    body: { sellingPrice, pin: OWNER_PIN },
  });
  if (r.status !== 200) {
    throw new Error(`setLocationPrice failed (product ${productId}, location ${locationId}): ${JSON.stringify(r.body)}`);
  }
}

async function setLocationPricingEnabled(token, productId, enabled) {
  const r = await api(`/api/products/${productId}/location-pricing`, {
    method: 'PATCH',
    token,
    body: { hasLocationPricing: enabled },
  });
  if (r.status !== 200) {
    throw new Error(`setLocationPricingEnabled failed (product ${productId}): ${JSON.stringify(r.body)}`);
  }
}

// Places an order over the given (bundleId, qtySetsRequested) pairs and packs every line to
// exactly what was requested — the owner only needs to bill from here, so short-packing on
// purpose would just be an extra step in the way of that.
async function placeAndPackOrder(token, partyId, lines) {
  const order = await api('/api/orders', {
    method: 'POST',
    token,
    body: { partyId, lineItems: lines.map(({ bundleId, qty }) => ({ bundleId, qtySetsRequested: qty })) },
  });
  if (!order.body?.id) {
    throw new Error(`Order creation failed: ${JSON.stringify(order.body)}`);
  }
  const packed = await api(`/api/orders/${order.body.id}/pack`, {
    method: 'PATCH',
    token,
    body: { lineItems: order.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (packed.status !== 200) {
    throw new Error(`Pack failed for order ${order.body.id}: ${JSON.stringify(packed.body)}`);
  }
  return order.body.id;
}

// --- Fixed names, reused across runs (see the file header) --------------------------------------
const FACTORY_NAME = 'HandsOn Factory';
const CATEGORY_NAME = 'HandsOn Category';
const PARTY_NAME = 'HandsOn Test Party';
const GURGAON_NAME = 'Gurgaon';
const DELHI_NAME = 'Delhi';

const ARTICLE_A = {
  articleNo: 'HANDS-A',
  name: 'Hands-On Article A (location-priced)',
  costPrice: 350,
  sellingPrice: 500,
  gurgaonPrice: 520,
  delhiPrice: 560,
  colorNames: ['HandsOn A Red', 'HandsOn A Blue'],
};
const ARTICLE_B = {
  articleNo: 'HANDS-B',
  name: 'Hands-On Article B (location pricing off)',
  costPrice: 200,
  sellingPrice: 300,
  colorNames: ['HandsOn B Green', 'HandsOn B Yellow'],
};

const STOCK_PER_LOCATION = 50; // sets — comfortably more than several manual bill attempts will use
const ORDER_LINE_QTY = 2; // sets requested per line, per order
const ORDERS_TO_CREATE = 3; // mobile screen, desktop modal, and one spare

async function main() {
  const ownerToken = await login('owner', 'owner1234');

  console.log('=== Factory / Category / Locations / Party ===');
  const factoryId = await findOrCreate(ownerToken, {
    label: 'Factory',
    listPath: '/api/factories',
    createPath: '/api/factories',
    matchName: FACTORY_NAME,
    createBody: { name: FACTORY_NAME },
  });
  const categoryId = await findOrCreate(ownerToken, {
    label: 'Category',
    listPath: '/api/categories',
    createPath: '/api/categories',
    matchName: CATEGORY_NAME,
    createBody: { name: CATEGORY_NAME },
  });
  const gurgaonId = await findOrCreate(ownerToken, {
    label: 'Location',
    listPath: '/api/locations',
    createPath: '/api/locations',
    matchName: GURGAON_NAME,
    createBody: { name: GURGAON_NAME },
  });
  const delhiId = await findOrCreate(ownerToken, {
    label: 'Location',
    listPath: '/api/locations',
    createPath: '/api/locations',
    matchName: DELHI_NAME,
    createBody: { name: DELHI_NAME },
  });
  const partyId = await findOrCreate(ownerToken, {
    label: 'Party',
    listPath: '/api/parties',
    createPath: '/api/parties',
    matchName: PARTY_NAME,
    createBody: { name: PARTY_NAME, state: 'MAHARASHTRA' },
  });

  console.log('\n=== Article HANDS-A (location pricing ON — Gurgaon 520, Delhi 560) ===');
  const productAId = await findOrCreateProduct(ownerToken, { ...ARTICLE_A, factoryId, categoryId });
  await setLocationPricingEnabled(ownerToken, productAId, true);
  await setLocationPrice(ownerToken, productAId, gurgaonId, ARTICLE_A.gurgaonPrice);
  await setLocationPrice(ownerToken, productAId, delhiId, ARTICLE_A.delhiPrice);
  console.log(`  location pricing ON, Gurgaon ${ARTICLE_A.gurgaonPrice}, Delhi ${ARTICLE_A.delhiPrice}`);

  const bundlesA = [];
  for (const colorName of ARTICLE_A.colorNames) {
    const colorId = await findOrCreate(ownerToken, {
      label: 'Colour',
      listPath: '/api/colors',
      createPath: '/api/colors',
      matchName: colorName,
      createBody: { name: colorName },
    });
    const bundleId = await findOrCreateBundle(ownerToken, productAId, colorId, colorName);
    await ensureStock(ownerToken, bundleId, gurgaonId, `${colorName} @ Gurgaon`, STOCK_PER_LOCATION);
    await ensureStock(ownerToken, bundleId, delhiId, `${colorName} @ Delhi`, STOCK_PER_LOCATION);
    bundlesA.push(bundleId);
  }

  console.log('\n=== Article HANDS-B (location pricing OFF — 300 everywhere) ===');
  const productBId = await findOrCreateProduct(ownerToken, { ...ARTICLE_B, factoryId, categoryId });
  await setLocationPricingEnabled(ownerToken, productBId, false);
  console.log('  location pricing OFF — bills at priceAtOrder (300) regardless of location');

  const bundlesB = [];
  for (const colorName of ARTICLE_B.colorNames) {
    const colorId = await findOrCreate(ownerToken, {
      label: 'Colour',
      listPath: '/api/colors',
      createPath: '/api/colors',
      matchName: colorName,
      createBody: { name: colorName },
    });
    const bundleId = await findOrCreateBundle(ownerToken, productBId, colorId, colorName);
    await ensureStock(ownerToken, bundleId, gurgaonId, `${colorName} @ Gurgaon`, STOCK_PER_LOCATION);
    await ensureStock(ownerToken, bundleId, delhiId, `${colorName} @ Delhi`, STOCK_PER_LOCATION);
    bundlesB.push(bundleId);
  }

  console.log(`\n=== Creating ${ORDERS_TO_CREATE} PACKED orders (both articles, both colours, ${ORDER_LINE_QTY} sets/line) ===`);
  const allBundles = [...bundlesA, ...bundlesB];
  const orderIds = [];
  for (let i = 1; i <= ORDERS_TO_CREATE; i++) {
    const orderId = await placeAndPackOrder(
      ownerToken,
      partyId,
      allBundles.map((bundleId) => ({ bundleId, qty: ORDER_LINE_QTY }))
    );
    console.log(`  order ${i}: ${orderId} — PACKED, ${allBundles.length} lines`);
    orderIds.push(orderId);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Party: ${PARTY_NAME} (${partyId})`);
  console.log(`Locations: Gurgaon (${gurgaonId}), Delhi (${delhiId})`);
  console.log(`Article ${ARTICLE_A.articleNo} (${productAId}) — location pricing ON:`);
  console.log(`  expected per-piece price at Gurgaon: ${ARTICLE_A.gurgaonPrice}`);
  console.log(`  expected per-piece price at Delhi:   ${ARTICLE_A.delhiPrice}`);
  console.log(`Article ${ARTICLE_B.articleNo} (${productBId}) — location pricing OFF:`);
  console.log(`  expected per-piece price everywhere: ${ARTICLE_B.sellingPrice}`);
  console.log('PACKED orders ready to bill by hand:');
  orderIds.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));
  console.log(
    '\nBill order 1 from the mobile screen, order 2 from the dashboard "Mark billed" modal, and ' +
      'keep order 3 spare. Try billing the same article from both Gurgaon and Delhi across ' +
      `different orders to see ${ARTICLE_A.articleNo}'s price change while ${ARTICLE_B.articleNo}'s stays fixed.`
  );
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
