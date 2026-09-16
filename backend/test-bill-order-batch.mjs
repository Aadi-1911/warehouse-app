// Real, persisted test for billOrder's batched STOCK_OUT deduction (2026-09-17). Same file
// convention as test-party-debit.mjs and test-transfer-idempotency.mjs (flat .mjs under backend/,
// same FK-safe self-cleaning discipline, same refuse-to-fall-back TEST_DATABASE_URL guard).
//
// WHAT THIS PROVES, and why it's worth a dedicated file: billOrder used to deduct stock one line
// at a time (3 sequential round-trips per line — applyStockMovement's upsert + guarded update,
// then a Transaction insert). For the real 17-line Arora Garments order in Production that was 54
// sequential round-trips inside one interactive transaction, and it failed with P2028
// ("Transaction already closed") at BOTH the 5000ms default and the 20000ms stopgap — confirmed
// via real Vercel logs and a direct Production query showing zero partial deduction (the whole
// transaction rolled back cleanly, as designed).
//
// The replacement batches the STOCK_OUT deduction: one bulk read for stock ids, deductions summed
// per DISTINCT bundle across every line first, grouped by quantity, one guarded updateMany per
// group. The single most important invariant of that redesign — and the one a batched rewrite is
// most likely to get silently wrong — is that TWO LINES ON THE SAME BUNDLE must both be deducted,
// summed, not just one of them. Scenario B below is written specifically to catch a regression of
// that exact invariant: if the per-bundle aggregation step were ever dropped or overwritten
// instead of summed, this test fails on a stock quantity, not silently.
//
// Scenario D exercises the other new branch entirely: the in-transaction guard-failure
// reconstruction path (`if (result.count !== ids.length)` in orderController.js), which only
// fires on a genuine concurrent race — two bills landing on overlapping stock at once. Scenarios
// A-C never touch that branch; without D it would be read-reviewed but never actually executed by
// any test in this file.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-bill-order-batch.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file makes its own direct Prisma queries (Stock/Transaction ground truth is the whole
// point), so it applies the same refuse-to-fall-back guard before any @prisma/client import.
const dotenv = await import('dotenv');
dotenv.config({ quiet: true });
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set — refusing to run this file\'s direct Prisma queries against DATABASE_URL and risk touching the real dev database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const BASE = 'http://localhost:3002';
const OWNER_PIN = '123456';

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

// Fails LOUDLY on a bad login — never silently skips whatever depended on the account.
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
  locationId: null,
  partyId: null,
  factoryId: null,
  categoryId: null,
  productIds: [],
  colorIds: [],
  bundleIds: [],
  orderIds: [],
};

// Locates targets by reference from the `created` tracker, same convergent-cleanup discipline
// test-transfer-idempotency.mjs already established — running this twice, or after a crash,
// lands on the same clean state. FK order derived from the real ON DELETE constraints
// (20260816173157_add_phase2_order_orderlineitem_orderadjustment/migration.sql): Order/
// OrderLineItem/OrderAdjustment are all RESTRICT, so children must go before parents; Transaction
// is already gone by bundleId scope before OrderLineItem is touched.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.bundleIds.length) {
      await p.transaction.deleteMany({ where: { stock: { bundleId: { in: created.bundleIds } } } });
    }
    if (created.orderIds.length) {
      await p.orderAdjustment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderLineItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      for (const orderId of created.orderIds) {
        await p.order.delete({ where: { id: orderId } }).catch(() => {});
      }
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
    if (created.factoryId) await p.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    if (created.categoryId) await p.category.delete({ where: { id: created.categoryId } }).catch(() => {});
    if (created.locationId) await p.location.delete({ where: { id: created.locationId } }).catch(() => {});
    console.log('  deleted transactions/order adjustments/line items/orders/stock/bundles/products/colors/party/factory/category/location');
  } finally {
    await p.$disconnect();
  }
}

// Creates one product (with a real sellingPrice, required for createOrder) plus `count` bundles
// (one per freshly-created color), stock-in `seedQty` sets each at the shared location. Returns
// the bundleIds in creation order, so callers can build line items against them directly.
async function makeArticleWithBundles(ownerToken, stamp, articleLabel, count, seedQty) {
  const p = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `${articleLabel}-${stamp}`,
      name: `${articleLabel} Test Article ${stamp}`,
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
      costPrice: 100,
      sellingPrice: 200,
      pin: OWNER_PIN,
    },
  });
  if (!p.body?.id) throw new Error(`Product creation failed for ${articleLabel}: ${JSON.stringify(p.body)}`);
  created.productIds.push(p.body.id);

  const bundleIds = [];
  for (let i = 0; i < count; i++) {
    const c = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `${articleLabel}Col-${stamp}-${i}` } });
    if (!c.body?.id) throw new Error(`Color creation failed: ${JSON.stringify(c.body)}`);
    created.colorIds.push(c.body.id);

    const b = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId: p.body.id, colorId: c.body.id } });
    if (!b.body?.id) throw new Error(`Bundle creation failed: ${JSON.stringify(b.body)}`);
    created.bundleIds.push(b.body.id);
    bundleIds.push(b.body.id);

    const stockIn = await api('/api/transactions', {
      method: 'POST',
      token: ownerToken,
      body: { bundleId: b.body.id, locationId: created.locationId, type: 'STOCK_IN', qtySets: seedQty },
    });
    if (stockIn.status !== 201) throw new Error(`Stock-in failed: ${JSON.stringify(stockIn.body)}`);
  }
  return bundleIds;
}

// Creates an order for the given (bundleId, qty) pairs, packs every line to its full requested
// quantity, and returns { orderId, lineItems } (lineItems in the same order as `pairs`, each
// carrying its real id and bundleId).
async function createAndPackOrder(ownerToken, pairs) {
  const orderRes = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: pairs.map(([bundleId, qty]) => ({ bundleId, qtySetsRequested: qty })) },
  });
  if (!orderRes.body?.id) throw new Error(`Order creation failed: ${JSON.stringify(orderRes.body)}`);
  created.orderIds.push(orderRes.body.id);
  const orderId = orderRes.body.id;
  const lineItems = orderRes.body.lineItems;

  const packRes = await api(`/api/orders/${orderId}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (packRes.status !== 200) throw new Error(`Pack failed: ${JSON.stringify(packRes.body)}`);

  return { orderId, lineItems };
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();
  const p = await db();

  console.log('\n=== SETUP: shared location, party, factory, category ===');
  let r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `BOBLoc-${stamp}` } });
  created.locationId = r.body.id;
  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `BOBParty-${stamp}`, state: 'MAHARASHTRA' } });
  created.partyId = r.body.id;
  r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `BOBFac-${stamp}` } });
  created.factoryId = r.body.id;
  r = await api('/api/categories', { method: 'POST', token: ownerToken, body: { name: `BOBCat-${stamp}` } });
  created.categoryId = r.body.id;
  check('setup: location/party/factory/category created', created.locationId && created.partyId && created.factoryId && created.categoryId);

  // ===========================================================================================
  // SCENARIO A — the real Arora Garments shape: 17 lines, 3 articles, same quantity split
  // (16 lines needing 1 set, 1 line needing 2 sets — matching the real Production order exactly).
  // Seeded at 5 sets/bundle so the post-bill remainder is easy to verify by hand.
  // ===========================================================================================
  console.log('\n=== SCENARIO A: real-shape order (17 lines, 3 articles) ===');
  const article1 = await makeArticleWithBundles(ownerToken, stamp, 'ADI', 6, 5); // 6 lines x 1 set
  const article2 = await makeArticleWithBundles(ownerToken, stamp, 'ADICress', 6, 5); // 6 lines x 1 set
  const article3 = await makeArticleWithBundles(ownerToken, stamp, 'ZARA', 5, 5); // 4 lines x 1 set + 1 line x 2 sets

  const pairsA = [
    ...article1.map((b) => [b, 1]),
    ...article2.map((b) => [b, 1]),
    ...article3.slice(0, 4).map((b) => [b, 1]),
    [article3[4], 2],
  ];
  check('scenario A: 17 lines built', pairsA.length === 17, `(built ${pairsA.length})`);

  const { orderId: orderA, lineItems: lineItemsA } = await createAndPackOrder(ownerToken, pairsA);

  const billA = await api(`/api/orders/${orderA}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  check('scenario A: bill returns 200', billA.status === 200, JSON.stringify(billA.body));
  check('scenario A: response status is BILLED', billA.body?.status === 'BILLED', JSON.stringify(billA.body?.status));

  const orderARow = await p.order.findUnique({ where: { id: orderA }, select: { status: true, billedAt: true } });
  check('DB: order A status is BILLED', orderARow?.status === 'BILLED', JSON.stringify(orderARow));
  check('DB: order A billedAt is set', orderARow?.billedAt != null);

  const stockA = await p.stock.findMany({ where: { bundleId: { in: [...article1, ...article2, ...article3] }, locationId: created.locationId }, select: { bundleId: true, qtySets: true } });
  const stockByBundleA = new Map(stockA.map((s) => [s.bundleId, s.qtySets]));
  const qty1Bundles = [...article1, ...article2, ...article3.slice(0, 4)];
  const allQty1Correct = qty1Bundles.every((b) => stockByBundleA.get(b) === 4); // 5 seeded - 1 deducted
  check('DB: all 16 qty-1 bundles now have 4 sets (5 - 1)', allQty1Correct, JSON.stringify(qty1Bundles.map((b) => [b, stockByBundleA.get(b)])));
  check('DB: the qty-2 bundle now has 3 sets (5 - 2)', stockByBundleA.get(article3[4]) === 3, `(got ${stockByBundleA.get(article3[4])})`);

  const txnsA = await p.transaction.findMany({ where: { orderLineItemId: { in: lineItemsA.map((li) => li.id) } }, select: { orderLineItemId: true, qtySets: true, type: true, stockId: true } });
  check('DB: exactly 17 Transaction rows for order A (one per line)', txnsA.length === 17, `(found ${txnsA.length})`);
  check('DB: all 17 are STOCK_OUT', txnsA.every((t) => t.type === 'STOCK_OUT'));
  const txnByLineA = new Map(txnsA.map((t) => [t.orderLineItemId, t]));
  const allLineQtysCorrect = lineItemsA.every((li) => {
    const expectedQty = li.bundleId === article3[4] ? 2 : 1;
    return txnByLineA.get(li.id)?.qtySets === expectedQty;
  });
  check('DB: every line\'s Transaction.qtySets matches what that line packed', allLineQtysCorrect);

  // ===========================================================================================
  // SCENARIO B — THE CRITICAL CASE: two separate line items on the SAME bundle, different
  // quantities (3 and 4). If per-bundle aggregation across lines were ever dropped (e.g. a
  // rewrite that grouped by quantity without summing needs per bundle first), this bundle's Stock
  // row would be decremented by only ONE line's need (3 or 4) instead of the sum (7) — silently,
  // with no thrown error and a count check that could still pass. Different quantities per line
  // (not the same number twice) make this the strongest possible check: the correct final
  // deduction (7) doesn't equal either individual line's need, so a "took the last line only" or
  // "took the first line only" bug is unambiguously visible on the stock number alone.
  // ===========================================================================================
  console.log('\n=== SCENARIO B: two line items on the SAME bundle (critical aggregation check) ===');
  const [dupBundle] = await makeArticleWithBundles(ownerToken, stamp, 'DUP', 1, 10);

  const { orderId: orderB, lineItems: lineItemsB } = await createAndPackOrder(ownerToken, [
    [dupBundle, 3],
    [dupBundle, 4],
  ]);
  check('scenario B: order has 2 line items, both on the same bundle', lineItemsB.length === 2 && lineItemsB[0].bundleId === dupBundle && lineItemsB[1].bundleId === dupBundle);

  const billB = await api(`/api/orders/${orderB}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  check('scenario B: bill returns 200', billB.status === 200, JSON.stringify(billB.body));

  const stockB = await p.stock.findUnique({ where: { bundleId_locationId: { bundleId: dupBundle, locationId: created.locationId } }, select: { qtySets: true } });
  check(
    'DB: stock deducted by the SUM of both lines (10 - 3 - 4 = 3), not just one line\'s need',
    stockB?.qtySets === 3,
    `(got ${stockB?.qtySets} — 7 would mean nothing was deducted, 7 or 6 or 3-off-by-one would mean only one line's need was applied)`
  );

  const txnsB = await p.transaction.findMany({ where: { orderLineItemId: { in: lineItemsB.map((li) => li.id) } }, select: { orderLineItemId: true, qtySets: true, stockId: true } });
  check('DB: exactly 2 Transaction rows for order B (one per line, not one per bundle)', txnsB.length === 2, `(found ${txnsB.length})`);
  const qtySetOfTxns = txnsB.map((t) => t.qtySets).sort((a, b) => a - b);
  check('DB: the two Transaction rows carry 3 and 4 respectively (not 3+3 or 4+4)', qtySetOfTxns.length === 2 && qtySetOfTxns[0] === 3 && qtySetOfTxns[1] === 4, JSON.stringify(qtySetOfTxns));
  check('DB: both Transaction rows reference the same Stock row (same bundle)', new Set(txnsB.map((t) => t.stockId)).size === 1);
  const sumOfTxnQty = txnsB.reduce((sum, t) => sum + t.qtySets, 0);
  check('DB: sum of both Transaction.qtySets equals total deducted (7)', sumOfTxnQty === 7, `(sum=${sumOfTxnQty})`);

  // ===========================================================================================
  // SCENARIO C — insufficient stock: confirm the 409's insufficientLines array keeps the exact,
  // pinned {lineItemId, bundleId, needed, available} shape (04_API_SPEC.md), unchanged by the
  // batched rewrite. This exercises the PRE-CHECK path (checkLocationAvailability, called before
  // the transaction even opens) — the same shared function the in-transaction race-path re-runs,
  // so this also indirectly proves that reconstruction path returns the identical shape.
  // ===========================================================================================
  console.log('\n=== SCENARIO C: insufficient stock — verify 409 insufficientLines shape ===');
  const [shortBundle] = await makeArticleWithBundles(ownerToken, stamp, 'SHORT', 1, 2); // only 2 in stock

  const { orderId: orderC, lineItems: lineItemsC } = await createAndPackOrder(ownerToken, [[shortBundle, 5]]); // pack 5, only 2 in stock

  const billC = await api(`/api/orders/${orderC}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  check('scenario C: bill returns 409', billC.status === 409, JSON.stringify(billC.body));
  check('scenario C: error code is INSUFFICIENT_STOCK', billC.body?.error?.code === 'INSUFFICIENT_STOCK', JSON.stringify(billC.body));
  check('scenario C: insufficientLines is present with exactly 1 entry', Array.isArray(billC.body?.insufficientLines) && billC.body.insufficientLines.length === 1, JSON.stringify(billC.body?.insufficientLines));
  const line = billC.body?.insufficientLines?.[0];
  check('scenario C: insufficientLines[0].lineItemId matches the real line', line?.lineItemId === lineItemsC[0].id, JSON.stringify(line));
  check('scenario C: insufficientLines[0].bundleId matches the short bundle', line?.bundleId === shortBundle, JSON.stringify(line));
  check('scenario C: insufficientLines[0].needed === 5', line?.needed === 5, JSON.stringify(line));
  check('scenario C: insufficientLines[0].available === 2', line?.available === 2, JSON.stringify(line));
  check(
    'scenario C: message names the exact needed/available numbers (singular-line phrasing)',
    typeof billC.body?.error?.message === 'string' && billC.body.error.message.includes('5') && billC.body.error.message.includes('2'),
    JSON.stringify(billC.body?.error)
  );

  // Confirm the order genuinely did NOT bill and nothing was deducted — same "did anything
  // partially happen?" discipline the Production incident investigation used.
  const orderCRow = await p.order.findUnique({ where: { id: orderC }, select: { status: true, billedAt: true } });
  check('DB: order C is still PACKED, not BILLED', orderCRow?.status === 'PACKED' && orderCRow?.billedAt == null, JSON.stringify(orderCRow));
  const stockC = await p.stock.findUnique({ where: { bundleId_locationId: { bundleId: shortBundle, locationId: created.locationId } }, select: { qtySets: true } });
  check('DB: short bundle\'s stock is untouched (still 2)', stockC?.qtySets === 2, `(got ${stockC?.qtySets})`);
  const txnsC = await p.transaction.findMany({ where: { orderLineItemId: lineItemsC[0].id } });
  check('DB: zero Transaction rows for the rejected line', txnsC.length === 0, `(found ${txnsC.length})`);

  // ===========================================================================================
  // SCENARIO D — forces the actual mid-transaction race branch (orderController.js's
  // `if (result.count !== ids.length)` block) to fire for real, not just read as correct.
  //
  // Two separate orders, each needing 3 sets of the SAME bundle, against a bundle seeded with
  // only 5 — combined demand (6) exceeds what's available, but EITHER order alone is well within
  // it (3 <= 5), so both requests' own pre-check (checkLocationAvailability, run before either
  // transaction opens) sees the untouched 5 and passes. The conflict can only be caught by the
  // in-transaction guard, which is exactly what this is testing. Fired via Promise.all — same
  // concurrency pattern test-transfer-idempotency.mjs already uses for its own race test — so
  // both PATCH .../bill calls are genuinely in flight at once, not sequential.
  //
  // Whichever transaction's guarded updateMany actually executes first in Postgres wins: it sees
  // qtySets=5 >= 3, decrements to 2, and proceeds to commit. The second transaction's updateMany
  // blocks on Postgres's row lock until the first commits, then re-evaluates its WHERE clause
  // against the now-current qtySets=2 — 2 >= 3 is false, matches zero rows, and
  // `result.count !== ids.length` (0 !== 1) fires the guard-failure branch, which re-runs
  // checkLocationAvailability WITH THIS TX and must report available: 2 — the real, current,
  // post-winner number — not the stale 5 either request's own pre-check saw.
  // ===========================================================================================
  console.log('\n=== SCENARIO D: two concurrent bills racing for the same insufficient bundle ===');
  const [raceBundle] = await makeArticleWithBundles(ownerToken, stamp, 'RACE', 1, 5); // exactly 5 in stock

  const { orderId: orderD1, lineItems: lineItemsD1 } = await createAndPackOrder(ownerToken, [[raceBundle, 3]]);
  const { orderId: orderD2, lineItems: lineItemsD2 } = await createAndPackOrder(ownerToken, [[raceBundle, 3]]);

  // Timed, not just fired — a boring outcome is possible here: if the two requests happened to
  // run fully sequentially instead of genuinely overlapping, the SECOND request's own pre-check
  // (checkLocationAvailability, before its transaction even opens) would already see the first
  // request's committed deduction and reject there — producing an IDENTICAL-looking 409 with the
  // same insufficientLines shape, without ever reaching the in-transaction guard this scenario
  // exists to exercise. The two paths are distinguishable by timing: a pre-check rejection fails
  // fast (a handful of quick reads, no transaction, no lock wait); an in-transaction rejection
  // BLOCKS on Postgres's row lock for the entire remaining duration of the winner's transaction
  // (its own updateMany, transaction.createMany, order.update, orderAdjustment.create,
  // order.findUnique) before Postgres re-evaluates its WHERE clause and returns 0 rows matched.
  // If the loser's elapsed time isn't meaningfully close to the winner's, this scenario proves
  // nothing beyond what scenario C already covers, and that's reported plainly below rather than
  // silently treated as success.
  const raceBillBody = { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false };
  const d1Start = Date.now();
  const d2Start = Date.now();
  const [respD1, respD2] = await Promise.all([
    api(`/api/orders/${orderD1}/bill`, { method: 'PATCH', token: ownerToken, body: raceBillBody }).then((r) => ({ ...r, elapsedMs: Date.now() - d1Start })),
    api(`/api/orders/${orderD2}/bill`, { method: 'PATCH', token: ownerToken, body: raceBillBody }).then((r) => ({ ...r, elapsedMs: Date.now() - d2Start })),
  ]);
  console.log(`  timing: D1=${respD1.elapsedMs}ms (status ${respD1.status})   D2=${respD2.elapsedMs}ms (status ${respD2.status})`);

  check(
    'scenario D: exactly one of the two concurrent bills returned 200',
    [respD1.status, respD2.status].filter((s) => s === 200).length === 1,
    `(D1=${respD1.status} D2=${respD2.status})`
  );
  check(
    'scenario D: exactly one of the two concurrent bills returned 409',
    [respD1.status, respD2.status].filter((s) => s === 409).length === 1,
    `(D1=${respD1.status} D2=${respD2.status})`
  );

  const d1Won = respD1.status === 200;
  const winner = d1Won
    ? { resp: respD1, orderId: orderD1, lineItems: lineItemsD1 }
    : { resp: respD2, orderId: orderD2, lineItems: lineItemsD2 };
  const loser = d1Won
    ? { resp: respD2, orderId: orderD2, lineItems: lineItemsD2 }
    : { resp: respD1, orderId: orderD1, lineItems: lineItemsD1 };
  // Guards the winner/loser split itself — if the two checks above already failed (both 200, both
  // 409, or anything else), don't let this silently assume a split that wasn't actually observed.
  check(
    'scenario D: winner/loser split is unambiguous (one 200, one 409)',
    winner.resp.status === 200 && loser.resp.status === 409,
    `(D1=${respD1.status} D2=${respD2.status})`
  );

  // THE branch-provenance check: if the loser's rejection came from the boring pre-check instead
  // of the in-transaction guard, its request would return fast and independently of the winner
  // (no lock wait) — its elapsed time would sit close to a normal failed request, well under the
  // winner's. If it blocked on the row lock as the guard-failure path requires, its elapsed time
  // is bounded BELOW by however long the winner's transaction took to commit, so it should land
  // at or above roughly the winner's own elapsed time, not meaningfully less than it.
  check(
    'scenario D: loser\'s elapsed time is NOT meaningfully shorter than the winner\'s (proves it blocked on the row lock, not a fast pre-check rejection)',
    loser.resp.elapsedMs >= winner.resp.elapsedMs * 0.8,
    `(winner=${winner.resp.elapsedMs}ms loser=${loser.resp.elapsedMs}ms)`
  );

  check('scenario D: loser gets INSUFFICIENT_STOCK', loser.resp.body?.error?.code === 'INSUFFICIENT_STOCK', JSON.stringify(loser.resp.body));
  check(
    'scenario D: loser\'s insufficientLines has exactly 1 entry',
    Array.isArray(loser.resp.body?.insufficientLines) && loser.resp.body.insufficientLines.length === 1,
    JSON.stringify(loser.resp.body?.insufficientLines)
  );
  const loserLine = loser.resp.body?.insufficientLines?.[0];
  check('scenario D: insufficientLines[0].lineItemId matches the LOSING order\'s own line', loserLine?.lineItemId === loser.lineItems[0].id, JSON.stringify(loserLine));
  check('scenario D: insufficientLines[0].bundleId matches the race bundle', loserLine?.bundleId === raceBundle, JSON.stringify(loserLine));
  check('scenario D: insufficientLines[0].needed === 3', loserLine?.needed === 3, JSON.stringify(loserLine));
  check(
    'scenario D: insufficientLines[0].available reflects the REAL post-winner stock (2), not the stale pre-check value (5)',
    loserLine?.available === 2,
    `(got ${loserLine?.available})`
  );

  // DB verification — same "did anything partially happen?" discipline the Production incident
  // investigations used throughout this file.
  const winnerOrderRow = await p.order.findUnique({ where: { id: winner.orderId }, select: { status: true, billedAt: true } });
  check('DB: winning order is BILLED', winnerOrderRow?.status === 'BILLED' && winnerOrderRow?.billedAt != null, JSON.stringify(winnerOrderRow));

  const loserOrderRow = await p.order.findUnique({ where: { id: loser.orderId }, select: { status: true, billedAt: true } });
  check('DB: losing order is still PACKED, never billed', loserOrderRow?.status === 'PACKED' && loserOrderRow?.billedAt == null, JSON.stringify(loserOrderRow));

  const raceStock = await p.stock.findUnique({ where: { bundleId_locationId: { bundleId: raceBundle, locationId: created.locationId } }, select: { qtySets: true } });
  check(
    'DB: bundle stock is exactly (5 - winner\'s 3) = 2 — not double-deducted, not left at 5',
    raceStock?.qtySets === 2,
    `(got ${raceStock?.qtySets})`
  );

  const winnerTxns = await p.transaction.findMany({ where: { orderLineItemId: winner.lineItems[0].id } });
  check('DB: winning order\'s line has exactly 1 Transaction row', winnerTxns.length === 1, `(found ${winnerTxns.length})`);
  check('DB: winning Transaction.qtySets === 3 (its own need, not the combined 6)', winnerTxns[0]?.qtySets === 3, `(got ${winnerTxns[0]?.qtySets})`);

  const loserTxns = await p.transaction.findMany({ where: { orderLineItemId: loser.lineItems[0].id } });
  check(
    'DB: losing order\'s line has ZERO Transaction rows — the failed deduction never partially applied',
    loserTxns.length === 0,
    `(found ${loserTxns.length})`
  );

  await cleanup();

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log('FAILED:', failures.join(', '));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\nFATAL:', err.message);
  try {
    await cleanup();
  } catch (cleanupErr) {
    console.error('cleanup also failed:', cleanupErr.message);
  }
  process.exit(1);
});
