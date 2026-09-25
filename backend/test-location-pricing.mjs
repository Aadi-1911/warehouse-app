// Real, persisted test for rule 111 — per-article, per-location SELLING price, resolved at billing
// against the location the order bills from. Same file convention as test-order-rounding.mjs /
// test-transfer-idempotency.mjs (flat .mjs under backend/, refuse-to-fall-back TEST_DATABASE_URL
// guard, convergent FK-safe cleanup).
//
// WHAT THIS PROVES, scenario by scenario:
//   A. The regression that matters most — an article with hasLocationPricing FALSE behaves exactly
//      as it did before rule 111 existed, even when LocationPrice rows for it DO exist with
//      different numbers. This is the strongest available form of "no default-false article's
//      behaviour changes": it doesn't merely check that nothing broke when the table is empty, it
//      plants live override rows and proves the toggle alone keeps them inert.
//   B. COST IS GLOBAL — one costPrice per article, identical at every location, with the toggle on
//      or off. Nothing location-shaped can move it.
//   C. SELLING FOLLOWS THE BILLING LOCATION — the headline rule. The same article, ordered twice,
//      billed from two different locations, is charged those two locations' prices.
//   D. Fallbacks, and the freeze. A billing location with no override bills at the line's own
//      priceAtOrder — and specifically NOT the article's CURRENT base price, proven by repricing
//      the article between placement and billing.
//   E. The PIN gate on the price endpoint, the deliberate absence of one on the toggle, the 400
//      for a body that still sends costPrice, and the price-range validation — 0 is rejected as
//      firmly as a negative, because an override of 0 would bill a party nothing.
//   F. STAFF never receives a cost field — from the product relation, from GET /api/stock, or from
//      the fulfillment preview.
//   G. GET /api/stock resolves each row against its OWN location.
//   H. Turning the toggle off makes overrides dormant WITHOUT deleting them.
//   I. Rule 101's discount/GST and rule 109's rounding are correct on a location-priced bill, and a
//      price edited AFTER billing does not move a single stored figure (rule 23).
//   J. The fulfillment preview quotes exactly what billOrder then charges, for both locations.
//
// Expected money figures are hard-coded from the arithmetic, never recomputed by calling
// computeBillingAmounts() or any pricing helper — an expectation that called the code under test
// would agree with a broken implementation by construction. Scenario I's numbers are chosen so
// every intermediate value is exactly representable in float64 (562.5 x 4 = 2250, -10% = 2025,
// +5% = 2126.25, rounds to 2126 with an adjustment of exactly -0.25), so the assertions can use
// === rather than an epsilon.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-location-pricing.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file makes its own direct Prisma queries (reading stored Decimal columns back is the point,
// and scenario H has to confirm rows still exist after the toggle is switched off), so it applies
// the same refuse-to-fall-back guard before any @prisma/client import.
const dotenv = await import('dotenv');
dotenv.config({ quiet: true });
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set — refusing to run this file\'s direct Prisma queries against DATABASE_URL and risk touching the real dev database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const BASE = 'http://localhost:3002';
const OWNER_PIN = '123456';

// The location RETURNS price against, by NAME — this must match utils/locationPricing.js's
// RETURN_PRICING_LOCATION_NAME. Deliberately re-stated as a literal here rather than imported: if
// someone changes that constant, this test should FAIL and force the business decision to be
// re-confirmed, not silently follow along. Orders no longer use it at all — they resolve against
// whichever location they bill from, which is exactly what scenario C proves.
const RETURN_PRICING_LOCATION_NAME = 'Gurgaon';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

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
        'This must abort the whole run, not skip whatever depended on this account.'
    );
  }
  return body.token;
}

let prisma = null;
async function db() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}

const created = {
  factoryId: null,
  categoryId: null,
  // The Gurgaon location is find-or-create: `createdGurgaon` records whether THIS run made it, so
  // cleanup never deletes a Gurgaon that already existed in the database for other reasons.
  gurgaonId: null,
  createdGurgaon: false,
  delhiId: null,
  partyId: null,
  staffUserId: null,
  productIds: [],
  colorIds: [],
  bundleIds: [],
  orderIds: [],
};

// Convergent cleanup by reference, same discipline as the sibling test files. FK order derived from
// the real ON DELETE constraints. LocationPrice is new in this task and goes near the front: it
// points AT Product and AT Location, both of which this test deletes, and both FKs are RESTRICT, so
// leaving a LocationPrice row behind would block the Product delete below with a P2003.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.productIds.length) {
      await p.locationPrice.deleteMany({ where: { productId: { in: created.productIds } } });
    }
    if (created.orderIds.length) {
      await p.orderBillingCorrection.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderAdjustment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderLineItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
    }
    if (created.bundleIds.length) {
      // PartyStockReturn points AT Bundle and AT Location, so it must go before either is deleted.
      // Scenario C logs a real return, so this is a live FK, not a defensive one.
      await p.partyStockReturn.deleteMany({ where: { bundleId: { in: created.bundleIds } } });
      await p.transaction.deleteMany({ where: { stock: { bundleId: { in: created.bundleIds } } } });
    }
    for (const orderId of created.orderIds) {
      await p.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    if (created.bundleIds.length) {
      await p.stock.deleteMany({ where: { bundleId: { in: created.bundleIds } } });
      for (const bundleId of created.bundleIds) {
        await p.bundle.delete({ where: { id: bundleId } }).catch(() => {});
      }
    }
    for (const productId of created.productIds) {
      await p.productSize.deleteMany({ where: { productId } });
      await p.product.delete({ where: { id: productId } }).catch(() => {});
    }
    for (const colorId of created.colorIds) {
      await p.color.delete({ where: { id: colorId } }).catch(() => {});
    }
    if (created.partyId) await p.party.delete({ where: { id: created.partyId } }).catch(() => {});
    if (created.staffUserId) await p.user.delete({ where: { id: created.staffUserId } }).catch(() => {});
    if (created.factoryId) await p.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    if (created.delhiId) await p.location.delete({ where: { id: created.delhiId } }).catch(() => {});
    if (created.createdGurgaon && created.gurgaonId) {
      await p.location.delete({ where: { id: created.gurgaonId } }).catch(() => {});
      console.log('  deleted the Gurgaon location THIS RUN created');
    } else {
      console.log('  left the pre-existing Gurgaon location alone');
    }
    console.log('  deleted location prices/orders/transactions/stock/bundles/products/colors/party/staff/factory/Delhi');
  } finally {
    await p.$disconnect();
  }
}

// One article, one colour, one bundle. piecesPerSet is 1 (a single non-kids size with qty 1), so
// every money figure below is a clean qtySets x price with no conversion to reason about.
async function makeArticle(ownerToken, stamp, label, { costPrice, sellingPrice }) {
  const prod = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `LP-${label}-${stamp}`,
      name: `LocPrice ${label} ${stamp}`,
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
      costPrice,
      sellingPrice,
      pin: OWNER_PIN,
    },
  });
  if (!prod.body?.id) throw new Error(`Product creation failed (${label}): ${JSON.stringify(prod.body)}`);
  created.productIds.push(prod.body.id);

  const col = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `LPCol-${label}-${stamp}` } });
  if (!col.body?.id) throw new Error(`Color creation failed (${label}): ${JSON.stringify(col.body)}`);
  created.colorIds.push(col.body.id);

  const bun = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId: prod.body.id, colorId: col.body.id } });
  if (!bun.body?.id) throw new Error(`Bundle creation failed (${label}): ${JSON.stringify(bun.body)}`);
  created.bundleIds.push(bun.body.id);

  return { productId: prod.body.id, bundleId: bun.body.id };
}

async function stockIn(ownerToken, bundleId, locationId, qtySets) {
  const r = await api('/api/transactions', {
    method: 'POST',
    token: ownerToken,
    body: { bundleId, locationId, type: 'STOCK_IN', qtySets },
  });
  if (r.status !== 201) throw new Error(`Stock-in failed: ${JSON.stringify(r.body)}`);
  return r.body.transaction.id;
}

// costPriceSnapshot is never returned by the API at any role (TRANSACTION_RESPONSE_SELECT omits it
// outright), so the only way to assert on it is to read the column directly. That is the point.
async function storedCostSnapshot(transactionId) {
  const p = await db();
  const row = await p.transaction.findUnique({ where: { id: transactionId }, select: { costPriceSnapshot: true } });
  return row.costPriceSnapshot === null ? null : Number(row.costPriceSnapshot);
}

async function storedPriceAtOrder(orderId) {
  const p = await db();
  const rows = await p.orderLineItem.findMany({ where: { orderId }, select: { priceAtOrder: true } });
  return rows.map((r) => Number(r.priceAtOrder));
}

// Read straight out of Postgres rather than trusting the API response — the STORED value is the
// thing rule 111 is actually about, and null (not billed / billed before 2026-09-25) has to stay
// distinguishable from a real figure, so nulls are preserved rather than coerced.
async function storedBilledUnitPrice(orderId) {
  const p = await db();
  const rows = await p.orderLineItem.findMany({ where: { orderId }, select: { billedUnitPrice: true } });
  return rows.map((r) => (r.billedUnitPrice === null ? null : Number(r.billedUnitPrice)));
}

// Same reasoning: the four rule-101/109 money columns, read from the database, not from whatever
// the bill response happened to echo back.
async function storedBilling(orderId) {
  const p = await db();
  const row = await p.order.findUnique({
    where: { id: orderId },
    select: { preTaxAmount: true, finalAmount: true, actualPayable: true, roundingAdjustment: true },
  });
  const num = (v) => (v === null ? null : Number(v));
  return {
    preTaxAmount: num(row.preTaxAmount),
    finalAmount: num(row.finalAmount),
    actualPayable: num(row.actualPayable),
    roundingAdjustment: num(row.roundingAdjustment),
  };
}

// Places an order, packs every line in full, and returns the order id plus its line ids. Every
// scenario below needs this exact three-step sequence before it can bill anything.
async function placeAndPack(ownerToken, bundleId, qtySetsRequested) {
  const order = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId, qtySetsRequested }] },
  });
  if (!order.body?.id) throw new Error(`Order failed: ${JSON.stringify(order.body)}`);
  created.orderIds.push(order.body.id);
  const packed = await api(`/api/orders/${order.body.id}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: order.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (packed.status !== 200) throw new Error(`Pack failed: ${JSON.stringify(packed.body)}`);
  return { orderId: order.body.id, lineItemIds: order.body.lineItems.map((li) => li.id) };
}

// Rule 113 (2026-09-25) — every bill must echo back the per-line prices the fulfillment preview
// showed, so the server can refuse to bill at a price the owner never actually saw. billOrder 400s
// without it, so this is not optional for any caller.
//
// Fetched immediately before each bill rather than reused across bills: the echo has to reflect
// THIS order at THIS location. No test in this file changes a price between the preview and the
// bill, so the staleness guard never fires here — the dedicated stale-price scenarios in
// test-bill-price-override.mjs are where that path is actually exercised.
async function seenPricesFor(token, orderId, locationId) {
  const r = await api(`/api/orders/${orderId}/fulfillment-preview?locationId=${locationId}`, { token });
  if (!Array.isArray(r.body?.lines)) {
    throw new Error(`fulfillment-preview failed for order ${orderId}: ${JSON.stringify(r.body)}`);
  }
  return r.body.lines.map((l) => ({ lineItemId: l.lineItemId, unitPrice: Number(l.billedUnitPrice) }));
}

async function bill(ownerToken, orderId, locationId, extra = {}) {
  // `extra` is spread LAST so a scenario can deliberately override seenPrices (or any other field)
  // to exercise a rejection path — the default is the correct, matching echo.
  const seenPrices = await seenPricesFor(ownerToken, orderId, locationId);
  return api(`/api/orders/${orderId}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices, ...extra },
  });
}

async function preview(token, orderId, locationId) {
  return api(`/api/orders/${orderId}/fulfillment-preview?locationId=${locationId}`, { token });
}

// sellingPrice is the only price this endpoint accepts (cost is global) — a body carrying
// costPrice is rejected with 400, which scenario E proves explicitly.
async function setLocationPrice(token, productId, locationId, body) {
  return api(`/api/products/${productId}/location-prices/${locationId}`, { method: 'PUT', token, body });
}

async function setToggle(token, productId, hasLocationPricing) {
  return api(`/api/products/${productId}/location-pricing`, {
    method: 'PATCH',
    token,
    body: { hasLocationPricing },
  });
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();

  console.log('\n=== SETUP: factory / category / Gurgaon / Delhi / party / staff ===');
  let r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `LPFactory-${stamp}` } });
  if (!r.body?.id) throw new Error(`Factory creation failed: ${JSON.stringify(r.body)}`);
  created.factoryId = r.body.id;

  // Find-or-create Gurgaon by name — rule 111 resolves it by name, so the test has to exercise the
  // real lookup rather than pointing the code at some arbitrary isolated location.
  const locations = await api('/api/locations', { token: ownerToken });
  const existingGurgaon = (locations.body || []).find((l) => l.name === RETURN_PRICING_LOCATION_NAME);
  if (existingGurgaon) {
    created.gurgaonId = existingGurgaon.id;
    console.log(`  reusing existing "${RETURN_PRICING_LOCATION_NAME}" location`);
  } else {
    r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: RETURN_PRICING_LOCATION_NAME } });
    if (!r.body?.id) throw new Error(`Gurgaon creation failed: ${JSON.stringify(r.body)}`);
    created.gurgaonId = r.body.id;
    created.createdGurgaon = true;
    console.log(`  created "${RETURN_PRICING_LOCATION_NAME}" location for this run`);
  }

  r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `LPDelhi-${stamp}` } });
  if (!r.body?.id) throw new Error(`Delhi creation failed: ${JSON.stringify(r.body)}`);
  created.delhiId = r.body.id;

  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `LPParty-${stamp}`, state: 'MAHARASHTRA' } });
  if (!r.body?.id) throw new Error(`Party creation failed: ${JSON.stringify(r.body)}`);
  created.partyId = r.body.id;

  const categories = await api('/api/categories', { token: ownerToken });
  created.categoryId = categories.body[0]?.id;
  if (!created.categoryId) throw new Error('No Category exists on the test branch — cannot create a Product.');

  // "probe" prefix required, not cosmetic: cleanup() hard-deletes this account, and rule 75
  // forbids hard-deleting a User except for exactly this one case — usernames starting with
  // "probe", which are test artifacts that never belonged to a real person. The old `lp_staff_`
  // name sat outside that exception, so the delete below was a rule violation in everything but
  // intent.
  const staffUsername = `probe_lp_staff_${stamp}`;
  const staffPassword = 'LpStaff!2026';
  r = await api('/api/users', {
    method: 'POST',
    token: ownerToken,
    body: { username: staffUsername, password: staffPassword, name: 'LP Staff', role: 'STAFF' },
  });
  if (!r.body?.id) throw new Error(`Staff user creation failed: ${JSON.stringify(r.body)}`);
  created.staffUserId = r.body.id;
  const staffToken = await login(staffUsername, staffPassword);

  // =====================================================================================
  console.log('\n=== A. DEFAULT-OFF REGRESSION: overrides exist but the toggle is off ===');
  // Base 100 / 500. A selling override planted at BOTH locations with a deliberately unmistakable
  // number (888) that could never be confused with the base figure — then the toggle is left off.
  const a = await makeArticle(ownerToken, stamp, 'A', { costPrice: 100, sellingPrice: 500 });

  let put = await setLocationPrice(ownerToken, a.productId, created.gurgaonId, { sellingPrice: 888, pin: OWNER_PIN });
  check('A1 override row can be written while the toggle is off', put.status === 200, `got ${put.status} ${JSON.stringify(put.body)}`);
  put = await setLocationPrice(ownerToken, a.productId, created.delhiId, { sellingPrice: 888, pin: OWNER_PIN });
  check('A2 second location override written', put.status === 200, `got ${put.status}`);

  const aProduct = await api(`/api/products/${a.productId}`, { token: ownerToken });
  check('A3 hasLocationPricing defaults to false on a new article', aProduct.body.hasLocationPricing === false, `got ${aProduct.body.hasLocationPricing}`);

  const aTxn = await stockIn(ownerToken, a.bundleId, created.delhiId, 10);
  check('A4 STOCK_IN snapshots the base cost 100', (await storedCostSnapshot(aTxn)) === 100, `got ${await storedCostSnapshot(aTxn)}`);

  const aOrder = await placeAndPack(ownerToken, a.bundleId, 2);
  const aPrices = await storedPriceAtOrder(aOrder.orderId);
  check('A5 priceAtOrder is the BASE selling price (500), not the 888 override', aPrices[0] === 500, `got ${aPrices[0]}`);
  check('A6 billedUnitPrice is NULL before billing', (await storedBilledUnitPrice(aOrder.orderId))[0] === null, `got ${(await storedBilledUnitPrice(aOrder.orderId))[0]}`);

  const aStock = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const aStockRow = aStock.body.find((s2) => s2.bundleId === a.bundleId);
  check('A7 GET /api/stock reports the BASE selling price (500)', Number(aStockRow.productSellingPrice) === 500, `got ${aStockRow?.productSellingPrice}`);

  // Billing from Delhi, whose override says 888, must still charge 500 — the toggle alone decides.
  const aBilled = await bill(ownerToken, aOrder.orderId, created.delhiId);
  check('A8 order bills with the toggle off', aBilled.status === 200, `got ${aBilled.status} ${JSON.stringify(aBilled.body)}`);
  check('A9 billedUnitPrice is ALWAYS written, even with the toggle off (500)', (await storedBilledUnitPrice(aOrder.orderId))[0] === 500, `got ${(await storedBilledUnitPrice(aOrder.orderId))[0]}`);
  check('A10 preTaxAmount ignores the 888 override (2 x 500 = 1000)', (await storedBilling(aOrder.orderId)).preTaxAmount === 1000, `got ${(await storedBilling(aOrder.orderId)).preTaxAmount}`);

  // =====================================================================================
  console.log('\n=== B. COST IS GLOBAL: one cost per article, at every location, either toggle ===');
  // Base cost 100. A selling override at Delhi exists and the toggle is ON — nothing about that
  // may touch cost, because there is no per-location cost to touch.
  const b = await makeArticle(ownerToken, stamp, 'B', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, b.productId, created.delhiId, { sellingPrice: 560, pin: OWNER_PIN });
  let tog = await setToggle(ownerToken, b.productId, true);
  check('B1 toggle turns on', tog.status === 200 && tog.body.hasLocationPricing === true, `got ${tog.status} ${JSON.stringify(tog.body?.hasLocationPricing)}`);

  const bDelhiTxn = await stockIn(ownerToken, b.bundleId, created.delhiId, 3);
  check('B2 STOCK_IN at Delhi snapshots the global cost 100', (await storedCostSnapshot(bDelhiTxn)) === 100, `got ${await storedCostSnapshot(bDelhiTxn)}`);

  const bGgnTxn = await stockIn(ownerToken, b.bundleId, created.gurgaonId, 3);
  check('B3 STOCK_IN at Gurgaon snapshots the SAME global cost 100', (await storedCostSnapshot(bGgnTxn)) === 100, `got ${await storedCostSnapshot(bGgnTxn)}`);

  // =====================================================================================
  console.log('\n=== C. SELLING PRICE follows the BILLING LOCATION ===');
  // Base 500, Gurgaon 520, Delhi 560. The SAME article is ordered twice and billed from the two
  // different locations — each order must carry that location's own price. This is the headline
  // rule and the whole reason this scenario exists.
  const c = await makeArticle(ownerToken, stamp, 'C', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, c.productId, created.gurgaonId, { sellingPrice: 520, pin: OWNER_PIN });
  await setLocationPrice(ownerToken, c.productId, created.delhiId, { sellingPrice: 560, pin: OWNER_PIN });
  await setToggle(ownerToken, c.productId, true);

  await stockIn(ownerToken, c.bundleId, created.delhiId, 20);
  await stockIn(ownerToken, c.bundleId, created.gurgaonId, 20);

  const cPrices = await storedPriceAtOrder((await placeAndPack(ownerToken, c.bundleId, 1)).orderId);
  check('C1 priceAtOrder is the BASE 500 — placement consults no location at all', cPrices[0] === 500, `got ${cPrices[0]}`);

  const cDelhi = await placeAndPack(ownerToken, c.bundleId, 4);
  const cDelhiBilled = await bill(ownerToken, cDelhi.orderId, created.delhiId);
  check('C2 order bills successfully from Delhi', cDelhiBilled.status === 200, `got ${cDelhiBilled.status} ${JSON.stringify(cDelhiBilled.body)}`);
  check('C3 billed from Delhi -> billedUnitPrice is Delhi\'s 560', (await storedBilledUnitPrice(cDelhi.orderId))[0] === 560, `got ${(await storedBilledUnitPrice(cDelhi.orderId))[0]}`);
  check('C4 preTaxAmount uses Delhi\'s price (4 x 560 = 2240)', (await storedBilling(cDelhi.orderId)).preTaxAmount === 2240, `got ${(await storedBilling(cDelhi.orderId)).preTaxAmount}`);

  const cGgn = await placeAndPack(ownerToken, c.bundleId, 4);
  const cGgnBilled = await bill(ownerToken, cGgn.orderId, created.gurgaonId);
  check('C5 order bills successfully from Gurgaon', cGgnBilled.status === 200, `got ${cGgnBilled.status} ${JSON.stringify(cGgnBilled.body)}`);
  check('C6 billed from Gurgaon -> billedUnitPrice is Gurgaon\'s 520', (await storedBilledUnitPrice(cGgn.orderId))[0] === 520, `got ${(await storedBilledUnitPrice(cGgn.orderId))[0]}`);
  check('C7 preTaxAmount uses Gurgaon\'s price (4 x 520 = 2080)', (await storedBilling(cGgn.orderId)).preTaxAmount === 2080, `got ${(await storedBilling(cGgn.orderId)).preTaxAmount}`);
  check('C8 the same article billed two ways produced two different prices', 2240 !== (await storedBilling(cGgn.orderId)).preTaxAmount);
  check('C9 priceAtOrder is untouched by billing on BOTH orders', (await storedPriceAtOrder(cDelhi.orderId))[0] === 500 && (await storedPriceAtOrder(cGgn.orderId))[0] === 500);

  // A Good Return stays pinned to Gurgaon regardless of where the stock physically comes back to —
  // the deliberate asymmetry with orders, stated in rule 111. A return has no order to mirror.
  const cReturn = await api('/api/returns', {
    method: 'POST',
    token: ownerToken,
    body: {
      partyId: created.partyId,
      locationId: created.delhiId,
      lines: [{ bundleId: c.bundleId, qtySets: 1, reason: 'SIZE_ISSUE' }],
    },
  });
  check('C10 Good Return accepted', cReturn.status === 201, `got ${cReturn.status} ${JSON.stringify(cReturn.body)}`);
  // POST /api/returns responds with an ARRAY (one entry per line) — res.status(201).json(created.map(toResponse)).
  const cReturnPrice = Number(cReturn.body?.[0]?.priceAtReturn);
  check('C11 priceAtReturn stays Gurgaon\'s 520 even though stock returned to Delhi', cReturnPrice === 520, `got ${cReturnPrice}`);

  // =====================================================================================
  console.log('\n=== D. FALLBACKS, and the freeze: no override -> priceAtOrder, never the CURRENT base ===');
  // Delhi overridden, Gurgaon deliberately left with no row at all.
  const d = await makeArticle(ownerToken, stamp, 'D', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, d.productId, created.delhiId, { sellingPrice: 610, pin: OWNER_PIN });
  await setToggle(ownerToken, d.productId, true);
  await stockIn(ownerToken, d.bundleId, created.gurgaonId, 20);
  await stockIn(ownerToken, d.bundleId, created.delhiId, 20);

  const dNoOverride = await placeAndPack(ownerToken, d.bundleId, 3);
  const dNoOverrideBilled = await bill(ownerToken, dNoOverride.orderId, created.gurgaonId);
  check('D1 bills from a location with no override row', dNoOverrideBilled.status === 200, `got ${dNoOverrideBilled.status} ${JSON.stringify(dNoOverrideBilled.body)}`);
  check('D2 no override -> billedUnitPrice falls back to priceAtOrder 500', (await storedBilledUnitPrice(dNoOverride.orderId))[0] === 500, `got ${(await storedBilledUnitPrice(dNoOverride.orderId))[0]}`);

  // THE FREEZE. Place an order at 500, then reprice the ARTICLE to 900 before billing. The bill
  // must still charge 500 — the price this party was quoted — not the article's new base price.
  // Without this assertion, "fall back to the base price" and "fall back to priceAtOrder" are
  // indistinguishable, and only one of them honours rule 23.
  const dFrozen = await placeAndPack(ownerToken, d.bundleId, 2);
  check('D3 quoted at 500 before the reprice', (await storedPriceAtOrder(dFrozen.orderId))[0] === 500, `got ${(await storedPriceAtOrder(dFrozen.orderId))[0]}`);
  const reprice = await api(`/api/products/${d.productId}`, {
    method: 'PATCH',
    token: ownerToken,
    body: { sellingPrice: 900, pin: OWNER_PIN },
  });
  check('D4 article repriced to 900 between placement and billing', reprice.status === 200 && Number(reprice.body.sellingPrice) === 900, `got ${reprice.status} ${JSON.stringify(reprice.body?.sellingPrice)}`);
  const dFrozenBilled = await bill(ownerToken, dFrozen.orderId, created.gurgaonId);
  check('D5 the reprice does not block billing', dFrozenBilled.status === 200, `got ${dFrozenBilled.status} ${JSON.stringify(dFrozenBilled.body)}`);
  check('D6 bill uses the ORIGINAL priceAtOrder 500, NOT the new base 900 (rule 23)', (await storedBilledUnitPrice(dFrozen.orderId))[0] === 500, `got ${(await storedBilledUnitPrice(dFrozen.orderId))[0]}`);
  check('D7 preTaxAmount is 2 x 500 = 1000, not 2 x 900 = 1800', (await storedBilling(dFrozen.orderId)).preTaxAmount === 1000, `got ${(await storedBilling(dFrozen.orderId)).preTaxAmount}`);

  // A location override still wins over priceAtOrder when one exists.
  const dOverride = await placeAndPack(ownerToken, d.bundleId, 2);
  await bill(ownerToken, dOverride.orderId, created.delhiId);
  check('D8 Delhi\'s override 610 beats priceAtOrder', (await storedBilledUnitPrice(dOverride.orderId))[0] === 610, `got ${(await storedBilledUnitPrice(dOverride.orderId))[0]}`);

  // =====================================================================================
  console.log('\n=== E. PIN GATE, costPrice rejection, and the deliberately un-gated toggle ===');
  const e = await makeArticle(ownerToken, stamp, 'E', { costPrice: 100, sellingPrice: 500 });

  let noPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 200 });
  check('E1 OWNER with NO pin is rejected 403', noPin.status === 403, `got ${noPin.status} ${JSON.stringify(noPin.body)}`);

  let badPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 200, pin: '000000' });
  check('E2 OWNER with a WRONG pin is rejected 403', badPin.status === 403, `got ${badPin.status}`);

  let staffPut = await setLocationPrice(staffToken, e.productId, created.delhiId, { sellingPrice: 200, pin: OWNER_PIN });
  check('E3 STAFF is rejected 403 even with the correct pin', staffPut.status === 403, `got ${staffPut.status}`);

  let goodPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 200, pin: OWNER_PIN });
  check('E4 OWNER with the correct pin succeeds', goodPin.status === 200, `got ${goodPin.status} ${JSON.stringify(goodPin.body)}`);

  // costPrice must be REJECTED, never silently dropped — a 200 for a write that didn't happen is
  // the worst available outcome on a money endpoint.
  let costOnly = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: 77, pin: OWNER_PIN });
  check('E5 a costPrice-only body is rejected 400', costOnly.status === 400, `got ${costOnly.status} ${JSON.stringify(costOnly.body)}`);
  let costPlusSelling = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: 77, sellingPrice: 300, pin: OWNER_PIN });
  check('E6 costPrice alongside a VALID sellingPrice is still rejected 400', costPlusSelling.status === 400, `got ${costPlusSelling.status}`);
  const eRowAfter = await api(`/api/products/${e.productId}`, { token: ownerToken });
  const eRow = eRowAfter.body.locationPrices.find((lp) => lp.locationId === created.delhiId);
  check('E7 the rejected request wrote NOTHING — sellingPrice is still 200', Number(eRow.sellingPrice) === 200, `got ${eRow?.sellingPrice}`);
  check('E8 LocationPrice rows carry no costPrice key at all', !('costPrice' in eRow), `keys=${JSON.stringify(Object.keys(eRow || {}))}`);

  // The toggle is deliberately NOT pin-gated — a price write requires a PIN, selecting which
  // already-PIN-gated price applies does not.
  let togNoPin = await setToggle(ownerToken, e.productId, true);
  check('E9 toggle succeeds with NO pin (deliberately not pin-gated)', togNoPin.status === 200, `got ${togNoPin.status} ${JSON.stringify(togNoPin.body)}`);

  let togStaff = await setToggle(staffToken, e.productId, false);
  check('E10 toggle still rejects STAFF 403 (OWNER-only, just not pin-gated)', togStaff.status === 403, `got ${togStaff.status}`);

  let togBad = await setToggle(ownerToken, e.productId, 'true');
  check('E11 toggle rejects the STRING "true" (strict boolean)', togBad.status === 400, `got ${togBad.status}`);

  let badPrice = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: -5, pin: OWNER_PIN });
  check('E12 negative price rejected 400', badPrice.status === 400, `got ${badPrice.status}`);

  let minusOne = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: -1, pin: OWNER_PIN });
  check('E13 -1 rejected 400', minusOne.status === 400, `got ${minusOne.status}`);

  // ZERO is rejected, and this is the assertion that matters most in this group: an override of 0
  // means "bill this article for nothing at this location", which would charge a real party
  // nothing for real goods with no error to notice it by. Distinct from null, which is the
  // supported way to stop overriding. Asserted as its own case because `>= 0` (every other price
  // check in this API) and `> 0` (this one) differ by exactly this input and nothing else.
  let zero = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 0, pin: OWNER_PIN });
  check('E14 ZERO rejected 400 — an override of 0 would bill a party nothing', zero.status === 400, `got ${zero.status} ${JSON.stringify(zero.body)}`);

  let emptyBody = await setLocationPrice(ownerToken, e.productId, created.delhiId, { pin: OWNER_PIN });
  check('E15 body with no sellingPrice rejected 400', emptyBody.status === 400, `got ${emptyBody.status}`);

  // 1 is the smallest accepted value — proves the boundary is at 0, not somewhere above it.
  let one = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 1, pin: OWNER_PIN });
  check('E16 1 is accepted (the boundary is exactly at 0)', one.status === 200 && Number(one.body.sellingPrice) === 1, `got ${one.status} ${JSON.stringify(one.body?.sellingPrice)}`);

  let clearIt = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: null, pin: OWNER_PIN });
  check('E17 explicit null is accepted and clears the override', clearIt.status === 200 && clearIt.body.sellingPrice === null, `got ${clearIt.status} ${JSON.stringify(clearIt.body?.sellingPrice)}`);

  // Read the row back out of Postgres — the clear has to have actually landed, not just been
  // echoed by the response shape.
  const clearedRow = await (await db()).locationPrice.findFirst({
    where: { productId: e.productId, locationId: created.delhiId },
    select: { sellingPrice: true },
  });
  check('E18 the cleared override is genuinely null in the database', clearedRow !== null && clearedRow.sellingPrice === null, `got ${JSON.stringify(clearedRow)}`);

  // And a rejected 0 must not have overwritten anything on its way to the 400.
  let restore = await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 250, pin: OWNER_PIN });
  check('E19 override re-set to 250', restore.status === 200, `got ${restore.status}`);
  await setLocationPrice(ownerToken, e.productId, created.delhiId, { sellingPrice: 0, pin: OWNER_PIN });
  const afterZero = await (await db()).locationPrice.findFirst({
    where: { productId: e.productId, locationId: created.delhiId },
    select: { sellingPrice: true },
  });
  check('E20 a rejected 0 wrote NOTHING — the row still holds 250', Number(afterZero.sellingPrice) === 250, `got ${afterZero?.sellingPrice}`);

  // =====================================================================================
  console.log('\n=== F. STAFF never receives a cost field, through any surface ===');
  const fOwner = await api(`/api/products/${c.productId}`, { token: ownerToken });
  const fStaff = await api(`/api/products/${c.productId}`, { token: staffToken });

  const ownerRow = fOwner.body.locationPrices.find((lp) => lp.locationId === created.delhiId);
  const staffRow = fStaff.body.locationPrices.find((lp) => lp.locationId === created.delhiId);

  check('F1 OWNER sees the override row', !!ownerRow, `locationPrices=${JSON.stringify(fOwner.body?.locationPrices)}`);
  check('F2 STAFF also sees the override row exists', !!staffRow);
  check('F3 STAFF DOES receive locationPrices[].sellingPrice (rule 10 restricts cost only)', 'sellingPrice' in staffRow);
  check('F4 STAFF does NOT receive Product.costPrice', !('costPrice' in fStaff.body), `keys=${JSON.stringify(Object.keys(fStaff.body))}`);
  check('F5 OWNER DOES receive Product.costPrice (the gate is by role, not a blanket removal)', 'costPrice' in fOwner.body);
  check('F6 no locationPrices row carries a cost key at any role',
    !Object.keys(ownerRow).some((k) => k.toLowerCase().includes('cost')) && !Object.keys(staffRow).some((k) => k.toLowerCase().includes('cost')),
    `owner=${JSON.stringify(Object.keys(ownerRow))} staff=${JSON.stringify(Object.keys(staffRow))}`);

  // The any-role stock endpoint must not leak cost either.
  const fStock = await api('/api/stock', { token: staffToken });
  const anyStockRow = fStock.body[0] || {};
  check('F7 GET /api/stock exposes no cost field of any kind to STAFF',
    !Object.keys(anyStockRow).some((k) => k.toLowerCase().includes('cost')),
    `keys=${JSON.stringify(Object.keys(anyStockRow))}`);

  // And neither must the fulfillment preview, at EITHER role. It is OWNER-gated today, so the
  // STAFF call is expected to 403 — asserted explicitly rather than assumed, and the OWNER
  // response is scanned field by field including inside every line.
  const fPreviewOrder = await placeAndPack(ownerToken, c.bundleId, 1);
  const fPreviewOwner = await preview(ownerToken, fPreviewOrder.orderId, created.delhiId);
  check('F8 preview succeeds for OWNER', fPreviewOwner.status === 200, `got ${fPreviewOwner.status} ${JSON.stringify(fPreviewOwner.body)}`);
  const previewJson = JSON.stringify(fPreviewOwner.body);
  check('F9 the ENTIRE preview payload contains no "cost" anywhere', !previewJson.toLowerCase().includes('cost'), `body=${previewJson}`);
  const fPreviewStaff = await preview(staffToken, fPreviewOrder.orderId, created.delhiId);
  check('F10 preview rejects STAFF 403 (OWNER-only route, so no cost can reach them at all)', fPreviewStaff.status === 403, `got ${fPreviewStaff.status}`);

  // =====================================================================================
  console.log('\n=== G. GET /api/stock resolves each row against its OWN location ===');
  // Article C: base 500, Gurgaon 520, Delhi 560, with stock at both locations already.
  const gStock = await api('/api/stock', { token: ownerToken });
  const gDelhi = gStock.body.find((s2) => s2.bundleId === c.bundleId && s2.locationId === created.delhiId);
  const gGgn = gStock.body.find((s2) => s2.bundleId === c.bundleId && s2.locationId === created.gurgaonId);
  check('G1 the Delhi row reports Delhi\'s 560', Number(gDelhi.productSellingPrice) === 560, `got ${gDelhi?.productSellingPrice}`);
  check('G2 the Gurgaon row reports Gurgaon\'s 520', Number(gGgn.productSellingPrice) === 520, `got ${gGgn?.productSellingPrice}`);
  check('G3 the same bundle reports two different prices in one response', Number(gDelhi.productSellingPrice) !== Number(gGgn.productSellingPrice));

  // =====================================================================================
  console.log('\n=== H. Toggling OFF makes overrides dormant, it does NOT delete them ===');
  const hOff = await setToggle(ownerToken, c.productId, false);
  check('H1 toggle turns off', hOff.status === 200 && hOff.body.hasLocationPricing === false, `got ${hOff.status}`);

  const hStock = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const hRow = hStock.body.find((s2) => s2.bundleId === c.bundleId);
  check('H2 with the toggle off, the Delhi row reverts to base 500', Number(hRow.productSellingPrice) === 500, `got ${hRow?.productSellingPrice}`);

  // And a bill from Delhi now charges priceAtOrder, not the still-stored 560.
  const hOrder = await placeAndPack(ownerToken, c.bundleId, 2);
  await bill(ownerToken, hOrder.orderId, created.delhiId);
  check('H3 with the toggle off, a Delhi bill charges priceAtOrder 500, not the dormant 560', (await storedBilledUnitPrice(hOrder.orderId))[0] === 500, `got ${(await storedBilledUnitPrice(hOrder.orderId))[0]}`);

  // The rows are still in Postgres, untouched — this is the archive-not-delete guarantee.
  const p = await db();
  const survivingRows = await p.locationPrice.findMany({
    where: { productId: c.productId },
    select: { locationId: true, sellingPrice: true },
  });
  check('H4 both LocationPrice rows still exist after turning the toggle off', survivingRows.length === 2, `got ${survivingRows.length}`);
  const survivingGgn = survivingRows.find((row) => row.locationId === created.gurgaonId);
  check('H5 the stored override values are unchanged (Gurgaon still 520)', Number(survivingGgn.sellingPrice) === 520, `got ${survivingGgn?.sellingPrice}`);

  // Flipping back on restores them with nothing re-entered.
  await setToggle(ownerToken, c.productId, true);
  const hBack = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const hBackRow = hBack.body.find((s2) => s2.bundleId === c.bundleId);
  check('H6 flipping back on restores Delhi\'s 560 with nothing re-entered', Number(hBackRow.productSellingPrice) === 560, `got ${hBackRow?.productSellingPrice}`);

  // =====================================================================================
  console.log('\n=== I. Rule 101 discount/GST + rule 109 rounding on a location-priced bill ===');
  // Base 500, Delhi 562.5. Order 4 sets, billed from Delhi with 10% discount and 5% GST.
  // Every figure below is worked out from the arithmetic, independently of the code under test:
  //   preTax  = 4 x 562.5           = 2250     (would be 2000 if it wrongly used priceAtOrder)
  //   discount= 2250 x 10%          =  225
  //   final   = 2250 - 225          = 2025     (rule 101: discount FIRST)
  //   gst     = 2025 x 5%           =  101.25  (rule 101: GST on the POST-discount figure)
  //   raw     = 2025 + 101.25       = 2126.25
  //   payable = Math.round(2126.25) = 2126     (rule 109)
  //   adjust  = 2126 - 2126.25      =   -0.25  (negative: the party was rounded DOWN)
  // Chosen so every intermediate is exactly representable in float64 — verified before writing.
  const i = await makeArticle(ownerToken, stamp, 'I', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, i.productId, created.delhiId, { sellingPrice: 562.5, pin: OWNER_PIN });
  await setToggle(ownerToken, i.productId, true);
  await stockIn(ownerToken, i.bundleId, created.delhiId, 20);

  const iOrder = await placeAndPack(ownerToken, i.bundleId, 4);
  const iBilled = await bill(ownerToken, iOrder.orderId, created.delhiId, {
    discountApplicable: true, discountPercent: 10, gstApplicable: true, gstPercent: 5,
  });
  check('I1 bills from Delhi with discount and GST', iBilled.status === 200, `got ${iBilled.status} ${JSON.stringify(iBilled.body)}`);
  const iStored = await storedBilling(iOrder.orderId);
  check('I2 billedUnitPrice is Delhi\'s 562.5', (await storedBilledUnitPrice(iOrder.orderId))[0] === 562.5, `got ${(await storedBilledUnitPrice(iOrder.orderId))[0]}`);
  check('I3 preTaxAmount 2250 (location-priced, NOT 2000 from priceAtOrder)', iStored.preTaxAmount === 2250, `got ${iStored.preTaxAmount}`);
  check('I4 finalAmount 2025 — discount applied FIRST (rule 101)', iStored.finalAmount === 2025, `got ${iStored.finalAmount}`);
  check('I5 actualPayable 2126 — GST on the post-discount figure, then rounded (rules 101 + 109)', iStored.actualPayable === 2126, `got ${iStored.actualPayable}`);
  check('I6 roundingAdjustment exactly -0.25, recorded not absorbed (rule 109)', iStored.roundingAdjustment === -0.25, `got ${iStored.roundingAdjustment}`);

  // RULE 23. Change Delhi's price AFTER billing and prove not one stored figure moves.
  const iRepriced = await setLocationPrice(ownerToken, i.productId, created.delhiId, { sellingPrice: 999, pin: OWNER_PIN });
  check('I7 Delhi override changed to 999 after the bill', iRepriced.status === 200, `got ${iRepriced.status}`);
  const iAfter = await storedBilling(iOrder.orderId);
  check('I8 billedUnitPrice on the billed order is STILL 562.5', (await storedBilledUnitPrice(iOrder.orderId))[0] === 562.5, `got ${(await storedBilledUnitPrice(iOrder.orderId))[0]}`);
  check('I9 preTaxAmount unchanged at 2250', iAfter.preTaxAmount === 2250, `got ${iAfter.preTaxAmount}`);
  check('I10 finalAmount unchanged at 2025', iAfter.finalAmount === 2025, `got ${iAfter.finalAmount}`);
  check('I11 actualPayable unchanged at 2126', iAfter.actualPayable === 2126, `got ${iAfter.actualPayable}`);
  check('I12 roundingAdjustment unchanged at -0.25', iAfter.roundingAdjustment === -0.25, `got ${iAfter.roundingAdjustment}`);

  // =====================================================================================
  console.log('\n=== J. The fulfillment preview quotes exactly what billOrder then charges ===');
  // Article C is back ON with Gurgaon 520 / Delhi 560. One PACKED order is previewed against BOTH
  // locations, then actually billed from one of them — the preview for that location must match
  // the bill to the rupee, because a preview the bill contradicts is worse than no preview at all.
  const jOrder = await placeAndPack(ownerToken, c.bundleId, 3);

  const jDelhiPreview = await preview(ownerToken, jOrder.orderId, created.delhiId);
  check('J1 preview against Delhi succeeds', jDelhiPreview.status === 200, `got ${jDelhiPreview.status} ${JSON.stringify(jDelhiPreview.body)}`);
  check('J2 Delhi preview line price is 560', Number(jDelhiPreview.body.lines[0].billedUnitPrice) === 560, `got ${jDelhiPreview.body?.lines?.[0]?.billedUnitPrice}`);
  check('J3 Delhi preview preTaxAmount is 3 x 560 = 1680', Number(jDelhiPreview.body.preTaxAmount) === 1680, `got ${jDelhiPreview.body?.preTaxAmount}`);

  const jGgnPreview = await preview(ownerToken, jOrder.orderId, created.gurgaonId);
  check('J4 preview against Gurgaon succeeds', jGgnPreview.status === 200, `got ${jGgnPreview.status}`);
  check('J5 Gurgaon preview line price is 520', Number(jGgnPreview.body.lines[0].billedUnitPrice) === 520, `got ${jGgnPreview.body?.lines?.[0]?.billedUnitPrice}`);
  check('J6 Gurgaon preview preTaxAmount is 3 x 520 = 1560', Number(jGgnPreview.body.preTaxAmount) === 1560, `got ${jGgnPreview.body?.preTaxAmount}`);
  check('J7 the two previews genuinely differ for the same order', Number(jDelhiPreview.body.preTaxAmount) !== Number(jGgnPreview.body.preTaxAmount));

  // Now bill it from Delhi and compare against the Delhi preview taken BEFORE the bill.
  const jBilled = await bill(ownerToken, jOrder.orderId, created.delhiId);
  check('J8 order bills from Delhi', jBilled.status === 200, `got ${jBilled.status} ${JSON.stringify(jBilled.body)}`);
  const jStored = await storedBilling(jOrder.orderId);
  check('J9 the bill charges exactly what the Delhi preview quoted per line (560)', (await storedBilledUnitPrice(jOrder.orderId))[0] === Number(jDelhiPreview.body.lines[0].billedUnitPrice), `preview=${jDelhiPreview.body?.lines?.[0]?.billedUnitPrice} billed=${(await storedBilledUnitPrice(jOrder.orderId))[0]}`);
  check('J10 the stored preTaxAmount equals the Delhi preview preTaxAmount', jStored.preTaxAmount === Number(jDelhiPreview.body.preTaxAmount), `preview=${jDelhiPreview.body?.preTaxAmount} stored=${jStored.preTaxAmount}`);
  check('J11 and it is the hard-coded 1680, so neither side is merely echoing the other', jStored.preTaxAmount === 1680, `got ${jStored.preTaxAmount}`);
}

try {
  await main();
} catch (err) {
  fail++;
  failures.push(`UNCAUGHT: ${err.message}`);
  console.error('\n!!! UNCAUGHT ERROR !!!');
  console.error(err);
} finally {
  await cleanup();
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}
