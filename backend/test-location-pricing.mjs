// Real, persisted test for rule 111 — per-article, per-location cost and selling price. Same file
// convention as test-order-rounding.mjs / test-transfer-idempotency.mjs (flat .mjs under backend/,
// refuse-to-fall-back TEST_DATABASE_URL guard, convergent FK-safe cleanup).
//
// WHAT THIS PROVES, scenario by scenario:
//   A. The regression that matters most — an article with hasLocationPricing FALSE behaves exactly
//      as it did before rule 111 existed, even when LocationPrice rows for it DO exist with
//      different numbers. This is the strongest available form of "no default-false article's
//      behaviour changes": it doesn't merely check that nothing broke when the table is empty, it
//      plants live override rows and proves the toggle alone keeps them inert.
//   B. Cost price resolves against the location stock physically arrives at.
//   C. Selling price for an Order is pinned to Gurgaon, NOT the location the order bills from.
//      This is the locked business rule and the least intuitive part of rule 111, so it is tested
//      against an order that deliberately bills from the OTHER location.
//   D. A row that overrides only one of the two fields falls back for the other.
//   E. The PIN gate on the new price endpoint, and the deliberate ABSENCE of one on the toggle.
//   F. STAFF never receives costPrice through the locationPrices relation — the nested half of
//      CLAUDE.md's first non-negotiable rule.
//   G. GET /api/stock resolves each row against its OWN location, the one selling-price site that
//      is not pinned to Gurgaon.
//   H. Turning the toggle off makes overrides dormant WITHOUT deleting them.
//
// Expected values are hard-coded, never recomputed by calling resolvePrice() — an expectation that
// called the code under test would agree with a broken implementation by construction.
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

// Rule 111's fixed pricing location, by NAME — this must match
// utils/locationPricing.js's ORDER_PRICING_LOCATION_NAME. Deliberately re-stated as a literal here
// rather than imported: if someone changes that constant, this test should FAIL and force the
// business decision to be re-confirmed, not silently follow along.
const PRICING_LOCATION_NAME = 'Gurgaon';

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
  const existingGurgaon = (locations.body || []).find((l) => l.name === PRICING_LOCATION_NAME);
  if (existingGurgaon) {
    created.gurgaonId = existingGurgaon.id;
    console.log(`  reusing existing "${PRICING_LOCATION_NAME}" location`);
  } else {
    r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: PRICING_LOCATION_NAME } });
    if (!r.body?.id) throw new Error(`Gurgaon creation failed: ${JSON.stringify(r.body)}`);
    created.gurgaonId = r.body.id;
    created.createdGurgaon = true;
    console.log(`  created "${PRICING_LOCATION_NAME}" location for this run`);
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

  const staffUsername = `lp_staff_${stamp}`;
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
  // Base 100 / 500. Overrides planted at BOTH locations with deliberately unmistakable numbers
  // (777 / 888) that could never be confused with the base figures — then the toggle is left off.
  const a = await makeArticle(ownerToken, stamp, 'A', { costPrice: 100, sellingPrice: 500 });

  let put = await setLocationPrice(ownerToken, a.productId, created.gurgaonId, { costPrice: 777, sellingPrice: 888, pin: OWNER_PIN });
  check('A1 override row can be written while the toggle is off', put.status === 200, `got ${put.status} ${JSON.stringify(put.body)}`);
  put = await setLocationPrice(ownerToken, a.productId, created.delhiId, { costPrice: 777, sellingPrice: 888, pin: OWNER_PIN });
  check('A2 second location override written', put.status === 200, `got ${put.status}`);

  const aProduct = await api(`/api/products/${a.productId}`, { token: ownerToken });
  check('A3 hasLocationPricing defaults to false on a new article', aProduct.body.hasLocationPricing === false, `got ${aProduct.body.hasLocationPricing}`);

  const aTxn = await stockIn(ownerToken, a.bundleId, created.delhiId, 5);
  const aSnap = await storedCostSnapshot(aTxn);
  check('A4 STOCK_IN snapshots the BASE cost (100), not the 777 override', aSnap === 100, `got ${aSnap}`);

  const aOrder = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: a.bundleId, qtySetsRequested: 2 }] },
  });
  if (!aOrder.body?.id) throw new Error(`Order A failed: ${JSON.stringify(aOrder.body)}`);
  created.orderIds.push(aOrder.body.id);
  const aPrices = await storedPriceAtOrder(aOrder.body.id);
  check('A5 priceAtOrder is the BASE selling price (500), not the 888 override', aPrices[0] === 500, `got ${aPrices[0]}`);

  const aStock = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const aStockRow = aStock.body.find((s) => s.bundleId === a.bundleId);
  check('A6 GET /api/stock reports the BASE selling price (500)', Number(aStockRow.productSellingPrice) === 500, `got ${aStockRow?.productSellingPrice}`);

  // =====================================================================================
  console.log('\n=== B. COST PRICE resolves against the location stock arrives at ===');
  // Base cost 100. Delhi overridden to 130 (higher transport). Gurgaon deliberately left with NO
  // override row at all, so it must fall back to the base.
  const b = await makeArticle(ownerToken, stamp, 'B', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, b.productId, created.delhiId, { costPrice: 130, pin: OWNER_PIN });
  let tog = await setToggle(ownerToken, b.productId, true);
  check('B1 toggle turns on', tog.status === 200 && tog.body.hasLocationPricing === true, `got ${tog.status} ${JSON.stringify(tog.body?.hasLocationPricing)}`);

  const bDelhiTxn = await stockIn(ownerToken, b.bundleId, created.delhiId, 3);
  check('B2 STOCK_IN at Delhi snapshots Delhi cost 130', (await storedCostSnapshot(bDelhiTxn)) === 130, `got ${await storedCostSnapshot(bDelhiTxn)}`);

  const bGgnTxn = await stockIn(ownerToken, b.bundleId, created.gurgaonId, 3);
  check('B3 STOCK_IN at Gurgaon (no override row) falls back to base cost 100', (await storedCostSnapshot(bGgnTxn)) === 100, `got ${await storedCostSnapshot(bGgnTxn)}`);

  // =====================================================================================
  console.log('\n=== C. SELLING PRICE for an Order is pinned to Gurgaon, not the billing location ===');
  // Base 500, Gurgaon 520, Delhi 560. The order is then BILLED OUT OF DELHI and must still carry
  // Gurgaon's 520 — that is the locked rule, and the whole reason this scenario exists.
  const c = await makeArticle(ownerToken, stamp, 'C', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, c.productId, created.gurgaonId, { sellingPrice: 520, pin: OWNER_PIN });
  await setLocationPrice(ownerToken, c.productId, created.delhiId, { sellingPrice: 560, pin: OWNER_PIN });
  await setToggle(ownerToken, c.productId, true);

  await stockIn(ownerToken, c.bundleId, created.delhiId, 10);
  const cOrder = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: c.bundleId, qtySetsRequested: 4 }] },
  });
  if (!cOrder.body?.id) throw new Error(`Order C failed: ${JSON.stringify(cOrder.body)}`);
  created.orderIds.push(cOrder.body.id);
  const cPrices = await storedPriceAtOrder(cOrder.body.id);
  check('C1 priceAtOrder is Gurgaon\'s 520, not base 500 and not Delhi\'s 560', cPrices[0] === 520, `got ${cPrices[0]}`);

  // Pack and bill FROM DELHI. priceAtOrder must be untouched by that choice.
  const cPacked = await api(`/api/orders/${cOrder.body.id}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: cOrder.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (cPacked.status !== 200) throw new Error(`Pack C failed: ${JSON.stringify(cPacked.body)}`);
  const cBilled = await api(`/api/orders/${cOrder.body.id}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.delhiId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  check('C2 order bills successfully from Delhi', cBilled.status === 200, `got ${cBilled.status} ${JSON.stringify(cBilled.body)}`);
  check('C3 preTaxAmount uses Gurgaon\'s price (4 x 520 = 2080) despite billing from Delhi', Number(cBilled.body.preTaxAmount) === 2080, `got ${cBilled.body?.preTaxAmount}`);
  check('C4 priceAtOrder unchanged by billing from the other location', (await storedPriceAtOrder(cOrder.body.id))[0] === 520);

  // A Good Return must credit at the SAME Gurgaon price, even though the stock physically comes
  // back to Delhi — otherwise the party's amountDue drifts (see returnController's comment).
  const cReturn = await api('/api/returns', {
    method: 'POST',
    token: ownerToken,
    body: {
      partyId: created.partyId,
      locationId: created.delhiId,
      lines: [{ bundleId: c.bundleId, qtySets: 1, reason: 'SIZE_ISSUE' }],
    },
  });
  check('C5 Good Return accepted', cReturn.status === 201, `got ${cReturn.status} ${JSON.stringify(cReturn.body)}`);
  // POST /api/returns responds with an ARRAY (one entry per line) — res.status(201).json(created.map(toResponse)).
  const cReturnPrice = Number(cReturn.body?.[0]?.priceAtReturn);
  check('C6 priceAtReturn is Gurgaon\'s 520 even though stock returned to Delhi', cReturnPrice === 520, `got ${cReturnPrice}`);

  // =====================================================================================
  console.log('\n=== D. PARTIAL OVERRIDE: one field set, the other falls back ===');
  // Delhi overrides cost only. Selling at Delhi must still come from the base price.
  const d = await makeArticle(ownerToken, stamp, 'D', { costPrice: 100, sellingPrice: 500 });
  await setLocationPrice(ownerToken, d.productId, created.delhiId, { costPrice: 111, pin: OWNER_PIN });
  await setToggle(ownerToken, d.productId, true);
  const dTxn = await stockIn(ownerToken, d.bundleId, created.delhiId, 2);
  check('D1 cost uses the Delhi override 111', (await storedCostSnapshot(dTxn)) === 111, `got ${await storedCostSnapshot(dTxn)}`);
  const dStock = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const dRow = dStock.body.find((s) => s.bundleId === d.bundleId);
  check('D2 selling falls back to base 500 (row exists but sellingPrice is null)', Number(dRow.productSellingPrice) === 500, `got ${dRow?.productSellingPrice}`);

  // Explicit null clears an override back to fallback, and is distinct from omitting the key.
  await setLocationPrice(ownerToken, d.productId, created.delhiId, { costPrice: null, pin: OWNER_PIN });
  const dTxn2 = await stockIn(ownerToken, d.bundleId, created.delhiId, 1);
  check('D3 explicit null clears the cost override, falling back to base 100', (await storedCostSnapshot(dTxn2)) === 100, `got ${await storedCostSnapshot(dTxn2)}`);

  // =====================================================================================
  console.log('\n=== E. PIN GATE on the price endpoint; deliberately NONE on the toggle ===');
  const e = await makeArticle(ownerToken, stamp, 'E', { costPrice: 100, sellingPrice: 500 });

  let noPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: 200 });
  check('E1 OWNER with NO pin is rejected 403', noPin.status === 403, `got ${noPin.status} ${JSON.stringify(noPin.body)}`);

  let badPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: 200, pin: '000000' });
  check('E2 OWNER with a WRONG pin is rejected 403', badPin.status === 403, `got ${badPin.status}`);

  let staffPut = await setLocationPrice(staffToken, e.productId, created.delhiId, { costPrice: 200, pin: OWNER_PIN });
  check('E3 STAFF is rejected 403 even with the correct pin', staffPut.status === 403, `got ${staffPut.status}`);

  let goodPin = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: 200, pin: OWNER_PIN });
  check('E4 OWNER with the correct pin succeeds', goodPin.status === 200, `got ${goodPin.status} ${JSON.stringify(goodPin.body)}`);

  // The toggle is deliberately NOT pin-gated — a price write requires a PIN, selecting which
  // already-PIN-gated price applies does not.
  let togNoPin = await setToggle(ownerToken, e.productId, true);
  check('E5 toggle succeeds with NO pin (deliberately not pin-gated)', togNoPin.status === 200, `got ${togNoPin.status} ${JSON.stringify(togNoPin.body)}`);

  let togStaff = await setToggle(staffToken, e.productId, false);
  check('E6 toggle still rejects STAFF 403 (OWNER-only, just not pin-gated)', togStaff.status === 403, `got ${togStaff.status}`);

  let togBad = await setToggle(ownerToken, e.productId, 'true');
  check('E7 toggle rejects the STRING "true" (strict boolean)', togBad.status === 400, `got ${togBad.status}`);

  let badPrice = await setLocationPrice(ownerToken, e.productId, created.delhiId, { costPrice: -5, pin: OWNER_PIN });
  check('E8 negative price rejected 400', badPrice.status === 400, `got ${badPrice.status}`);

  let emptyBody = await setLocationPrice(ownerToken, e.productId, created.delhiId, { pin: OWNER_PIN });
  check('E9 body with neither price field rejected 400', emptyBody.status === 400, `got ${emptyBody.status}`);

  // =====================================================================================
  console.log('\n=== F. STAFF never receives costPrice through the locationPrices relation ===');
  const fOwner = await api(`/api/products/${e.productId}`, { token: ownerToken });
  const fStaff = await api(`/api/products/${e.productId}`, { token: staffToken });

  const ownerRow = fOwner.body.locationPrices.find((lp) => lp.locationId === created.delhiId);
  const staffRow = fStaff.body.locationPrices.find((lp) => lp.locationId === created.delhiId);

  check('F1 OWNER sees the override row', !!ownerRow, `locationPrices=${JSON.stringify(fOwner.body?.locationPrices)}`);
  check('F2 OWNER sees its costPrice (200)', Number(ownerRow.costPrice) === 200, `got ${ownerRow?.costPrice}`);
  check('F3 STAFF still sees the override row exists', !!staffRow);
  check('F4 STAFF does NOT receive locationPrices[].costPrice', staffRow !== undefined && !('costPrice' in staffRow), `keys=${JSON.stringify(Object.keys(staffRow || {}))}`);
  check('F5 STAFF does NOT receive Product.costPrice either (pre-existing rule, still holds)', !('costPrice' in fStaff.body), `keys=${JSON.stringify(Object.keys(fStaff.body))}`);
  check('F6 STAFF DOES receive locationPrices[].sellingPrice (rule 10 restricts cost only)', 'sellingPrice' in staffRow);

  // The any-role stock endpoint must not leak cost through the relation either.
  const fStock = await api('/api/stock', { token: staffToken });
  const anyStockRow = fStock.body[0] || {};
  check('F7 GET /api/stock exposes no cost field of any kind to STAFF',
    !Object.keys(anyStockRow).some((k) => k.toLowerCase().includes('cost')),
    `keys=${JSON.stringify(Object.keys(anyStockRow))}`);

  // =====================================================================================
  console.log('\n=== G. GET /api/stock resolves each row against its OWN location ===');
  // Base 500, Gurgaon 520, Delhi 560 — article C, which has stock at Delhi already. Add Gurgaon
  // stock so both rows exist and must report DIFFERENT selling prices from one response.
  await stockIn(ownerToken, c.bundleId, created.gurgaonId, 5);
  const gStock = await api('/api/stock', { token: ownerToken });
  const gDelhi = gStock.body.find((s) => s.bundleId === c.bundleId && s.locationId === created.delhiId);
  const gGgn = gStock.body.find((s) => s.bundleId === c.bundleId && s.locationId === created.gurgaonId);
  check('G1 the Delhi row reports Delhi\'s 560', Number(gDelhi.productSellingPrice) === 560, `got ${gDelhi?.productSellingPrice}`);
  check('G2 the Gurgaon row reports Gurgaon\'s 520', Number(gGgn.productSellingPrice) === 520, `got ${gGgn?.productSellingPrice}`);
  check('G3 the same bundle reports two different prices in one response', Number(gDelhi.productSellingPrice) !== Number(gGgn.productSellingPrice));

  // =====================================================================================
  console.log('\n=== H. Toggling OFF makes overrides dormant, it does NOT delete them ===');
  const hOff = await setToggle(ownerToken, c.productId, false);
  check('H1 toggle turns off', hOff.status === 200 && hOff.body.hasLocationPricing === false, `got ${hOff.status}`);

  const hStock = await api(`/api/stock?locationId=${created.delhiId}`, { token: ownerToken });
  const hRow = hStock.body.find((s) => s.bundleId === c.bundleId);
  check('H2 with the toggle off, the Delhi row reverts to base 500', Number(hRow.productSellingPrice) === 500, `got ${hRow?.productSellingPrice}`);

  const hTxn = await stockIn(ownerToken, c.bundleId, created.delhiId, 1);
  check('H3 with the toggle off, cost reverts to base 100', (await storedCostSnapshot(hTxn)) === 100, `got ${await storedCostSnapshot(hTxn)}`);

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
  const hBackRow = hBack.body.find((s) => s.bundleId === c.bundleId);
  check('H6 flipping back on restores Delhi\'s 560 with nothing re-entered', Number(hBackRow.productSellingPrice) === 560, `got ${hBackRow?.productSellingPrice}`);
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
