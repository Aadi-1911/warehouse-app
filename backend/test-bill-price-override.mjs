// Real, persisted test for rule 113 — the OWNER may change an article's unit price AT BILLING,
// for that one bill only, behind a PIN. Same file convention as every other real test here (flat
// .mjs under backend/, refuse-to-fall-back TEST_DATABASE_URL guard, convergent FK-safe cleanup).
//
// WHAT THIS FILE IS ACTUALLY FOR. Most of it is not about the happy path — a price changes, the
// bill charges it — which is two assertions. It is about the GATE: rule 113's PIN requirement is
// conditional (no change, no PIN), and a conditional gate is only worth having if it cannot be
// talked out of firing. Scenarios B1–B6 are deliberate bypass attempts, each built from a real
// failure shape this codebase has already seen once:
//
//   - an unrecognised body shape, which is exactly how routes/products.js's requirePinForPriceEdits
//     could be defeated (its own route file, lines 60-67, says so);
//   - an empty override list, the "technically I sent the field" case;
//   - an override equal to the baseline, the "nothing changed so nothing to authorise" case;
//   - an article not on the order, which would otherwise make this endpoint a probe.
//
// The assertion that matters in each is not just the status code but that NO PRICE MOVED — a
// bypass that gets a 200 while changing nothing is not a bypass.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-bill-price-override.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset. Billing is irreversible.
//
// This file makes its own direct Prisma queries (reading OrderPriceOverride and billedUnitPrice
// back is half the point), so it applies the same refuse-to-fall-back guard before any
// @prisma/client import.
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
  locationId: null,
  partyId: null,
  staffUserId: null,
  // A SECOND owner, used only by the lockout scenario. See scenario H for why the lockout must
  // never be burned on the shared "owner" account.
  lockoutOwnerId: null,
  productIds: [],
  colorIds: [],
  bundleIds: [],
  orderIds: [],
};

// Convergent cleanup by reference, same discipline as the sibling test files. FK order derived
// from the real ON DELETE constraints.
//
// OrderPriceOverride goes FIRST among the order-family deletes and is new in this task: it points
// AT Order, AT Product and AT User, all three RESTRICT (see its migration's header), so leaving a
// row behind would block all three of those deletes further down with a P2003.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.orderIds.length) {
      await p.orderPriceOverride.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderBillingCorrection.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderAdjustment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderLineItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
    }
    if (created.productIds.length) {
      await p.locationPrice.deleteMany({ where: { productId: { in: created.productIds } } });
    }
    if (created.bundleIds.length) {
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
    if (created.factoryId) await p.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    if (created.locationId) await p.location.delete({ where: { id: created.locationId } }).catch(() => {});
    // Users LAST, after every row that could reference a userId. Hard-deleting a User is normally
    // forbidden (rule 75); the one exception is a username starting with "probe", which is why
    // both accounts this file creates are named that way.
    if (created.staffUserId) await p.user.delete({ where: { id: created.staffUserId } }).catch(() => {});
    if (created.lockoutOwnerId) await p.user.delete({ where: { id: created.lockoutOwnerId } }).catch(() => {});
    console.log('  deleted overrides/orders/transactions/stock/bundles/products/colors/party/factory/location/users');
  } finally {
    await p.$disconnect();
  }
}

// --- fixtures ---------------------------------------------------------------------------------

// piecesPerSet is deliberately 1 throughout this file (one non-kids size at qty 1), so
// preTaxAmount = qtySets x unitPrice exactly. That keeps every expected figure below plain
// arithmetic a person can check by eye, rather than something only the code under test can produce.
async function makeArticle(ownerToken, stamp, label, { sellingPrice, costPrice = 100 }) {
  const prod = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `BPO-${label}-${stamp}`,
      name: `Override ${label} ${stamp}`,
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
  return prod.body.id;
}

async function makeColorBundle(ownerToken, stamp, productId, label) {
  const col = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `BPOCol-${label}-${stamp}` } });
  if (!col.body?.id) throw new Error(`Color creation failed (${label}): ${JSON.stringify(col.body)}`);
  created.colorIds.push(col.body.id);
  const bun = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId, colorId: col.body.id } });
  if (!bun.body?.id) throw new Error(`Bundle creation failed (${label}): ${JSON.stringify(bun.body)}`);
  created.bundleIds.push(bun.body.id);
  await api('/api/transactions', {
    method: 'POST',
    token: ownerToken,
    body: { bundleId: bun.body.id, locationId: created.locationId, type: 'STOCK_IN', qtySets: 200 },
  });
  return bun.body.id;
}

// Creates an order over the given (bundleId, qty) pairs and packs every line in full.
async function createAndPackOrder(ownerToken, pairs) {
  const ord = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: pairs.map(([bundleId, qty]) => ({ bundleId, qtySetsRequested: qty })) },
  });
  if (!ord.body?.id) throw new Error(`Order creation failed: ${JSON.stringify(ord.body)}`);
  created.orderIds.push(ord.body.id);
  const packed = await api(`/api/orders/${ord.body.id}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: ord.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (packed.status !== 200) throw new Error(`Pack failed: ${JSON.stringify(packed.body)}`);
  return { orderId: ord.body.id, lineItemIds: ord.body.lineItems.map((li) => li.id) };
}

async function preview(token, orderId, locationId = created.locationId) {
  return api(`/api/orders/${orderId}/fulfillment-preview?locationId=${locationId}`, { token });
}

// The correct seenPrices echo for an order, read from the preview the owner's screen uses.
async function seenPricesFor(token, orderId, locationId = created.locationId) {
  const r = await preview(token, orderId, locationId);
  if (!Array.isArray(r.body?.lines)) {
    throw new Error(`fulfillment-preview failed for order ${orderId}: ${JSON.stringify(r.body)}`);
  }
  return r.body.lines.map((l) => ({ lineItemId: l.lineItemId, unitPrice: Number(l.billedUnitPrice) }));
}

// Bills with a correct, freshly-fetched echo by default. `extra` is spread LAST so any scenario can
// replace seenPrices (or omit it, via a sentinel) to exercise a rejection path.
async function bill(token, orderId, extra = {}) {
  const seenPrices = await seenPricesFor(token, orderId);
  return api(`/api/orders/${orderId}/bill`, {
    method: 'PATCH',
    token,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices, ...extra },
  });
}

async function lineItemsOf(orderId) {
  const p = await db();
  return p.orderLineItem.findMany({ where: { orderId }, select: { id: true, billedUnitPrice: true, priceAtOrder: true } });
}

async function overrideRowsOf(orderId) {
  const p = await db();
  return p.orderPriceOverride.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
}

async function orderRow(orderId) {
  const p = await db();
  return p.order.findUnique({ where: { id: orderId } });
}

// --- main -------------------------------------------------------------------------------------

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();

  console.log('\n=== SETUP ===');
  let r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `BPOLoc-${stamp}` } });
  if (!r.body?.id) throw new Error(`Location creation failed: ${JSON.stringify(r.body)}`);
  created.locationId = r.body.id;

  r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `BPOFac-${stamp}` } });
  if (!r.body?.id) throw new Error(`Factory creation failed: ${JSON.stringify(r.body)}`);
  created.factoryId = r.body.id;

  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `BPOParty-${stamp}`, state: 'MAHARASHTRA' } });
  if (!r.body?.id) throw new Error(`Party creation failed: ${JSON.stringify(r.body)}`);
  created.partyId = r.body.id;

  const categories = await api('/api/categories', { token: ownerToken });
  created.categoryId = categories.body[0]?.id;
  if (!created.categoryId) throw new Error('No Category exists on the test branch — cannot create a Product.');

  // "probe" prefix required — cleanup() hard-deletes this account and rule 75 permits that only
  // for probe-prefixed test artifacts. `${stamp}` so a crashed run cannot wedge the next one on
  // User.username's unique constraint.
  const staffUsername = `probe_bpo_staff_${stamp}`;
  const staffPassword = 'ProbeStaff!2026';
  r = await api('/api/users', {
    method: 'POST', token: ownerToken,
    body: { username: staffUsername, password: staffPassword, name: 'BPO Probe Staff', role: 'STAFF' },
  });
  if (!r.body?.id) throw new Error(`Staff user creation failed: ${JSON.stringify(r.body)}`);
  created.staffUserId = r.body.id;
  const staffToken = await login(staffUsername, staffPassword);

  // =============================================================================================
  console.log('\n=== A. HAPPY PATH: a price change bills at the new price, with a PIN ===');
  const aProduct = await makeArticle(ownerToken, stamp, 'A', { sellingPrice: 500, costPrice: 100 });
  const aBundle = await makeColorBundle(ownerToken, stamp, aProduct, 'A');
  const a = await createAndPackOrder(ownerToken, [[aBundle, 5]]);

  let billed = await bill(ownerToken, a.orderId, {
    priceOverrides: [{ productId: aProduct, unitPrice: 480 }],
    pin: OWNER_PIN,
  });
  check('A1 changed price + correct PIN bills', billed.status === 200, JSON.stringify(billed.body).slice(0, 200));
  // 5 sets x 1 piece x 480 = 2400 exactly.
  check('A2 preTaxAmount uses the OVERRIDDEN price (5 x 480 = 2400)', Number(billed.body?.preTaxAmount) === 2400, `(${billed.body?.preTaxAmount})`);
  let lines = await lineItemsOf(a.orderId);
  check('A3 billedUnitPrice stored as 480 on every line', lines.every((l) => Number(l.billedUnitPrice) === 480), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));
  check('A4 priceAtOrder is UNTOUCHED at 500 — the quote and the charge are separate facts',
    lines.every((l) => Number(l.priceAtOrder) === 500), JSON.stringify(lines.map((l) => String(l.priceAtOrder))));
  let rows = await overrideRowsOf(a.orderId);
  check('A5 exactly one OrderPriceOverride row', rows.length === 1, `(${rows.length})`);
  check('A6 row records baseline 500 -> 480, min === max', rows.length === 1 &&
    Number(rows[0].baselineMinUnitPrice) === 500 && Number(rows[0].baselineMaxUnitPrice) === 500 &&
    Number(rows[0].overriddenUnitPrice) === 480, JSON.stringify(rows[0]));
  check('A7 row snapshots the article number and name', rows.length === 1 &&
    rows[0].articleNoSnapshot === `BPO-A-${stamp}` && rows[0].productNameSnapshot === `Override A ${stamp}`, JSON.stringify(rows[0]));

  // =============================================================================================
  console.log('\n=== B. BYPASS ATTEMPTS — the whole point of this file ===');
  const bProduct = await makeArticle(ownerToken, stamp, 'B', { sellingPrice: 500 });
  const bBundle = await makeColorBundle(ownerToken, stamp, bProduct, 'B');

  // B1 — no PIN at all on a changed price.
  let b = await createAndPackOrder(ownerToken, [[bBundle, 2]]);
  r = await bill(ownerToken, b.orderId, { priceOverrides: [{ productId: bProduct, unitPrice: 450 }] });
  check('B1 changed price with NO pin -> 403 MISSING_PIN', r.status === 403 && r.body?.error?.code === 'MISSING_PIN', JSON.stringify(r.body));
  let ord = await orderRow(b.orderId);
  check('B1b order still PACKED, nothing written', ord.status === 'PACKED' && ord.billedAt === null, `(${ord.status})`);
  lines = await lineItemsOf(b.orderId);
  check('B1c billedUnitPrice still null on every line', lines.every((l) => l.billedUnitPrice === null), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));

  // B2 — wrong PIN.
  r = await bill(ownerToken, b.orderId, { priceOverrides: [{ productId: bProduct, unitPrice: 450 }], pin: '999999' });
  check('B2 wrong PIN -> 403 INVALID_PIN', r.status === 403 && r.body?.error?.code === 'INVALID_PIN', JSON.stringify(r.body));
  check('B2b attemptsRemaining reported (shared lockout counters, not a second copy)',
    typeof r.body?.attemptsRemaining === 'number', JSON.stringify(r.body));
  ord = await orderRow(b.orderId);
  check('B2c order STILL PACKED after a wrong PIN', ord.status === 'PACKED', `(${ord.status})`);

  // B3 — THE body-shape bypass. The same override, under a key the server does not know.
  // Two things must be true: the request is rejected outright (strict allowlist), AND the price
  // could not have moved even if it had been accepted.
  r = await bill(ownerToken, b.orderId, { prices: [{ productId: bProduct, unitPrice: 450 }] });
  check('B3 unknown top-level key -> 400', r.status === 400 && r.body?.error?.code === 'VALIDATION_ERROR', JSON.stringify(r.body));
  check('B3b the 400 NAMES the offending key', (r.body?.error?.message || '').includes('prices'), r.body?.error?.message);
  ord = await orderRow(b.orderId);
  check('B3c order still PACKED', ord.status === 'PACKED', `(${ord.status})`);

  // B4 — a second unknown key, and a known key misspelled. Both named at once, not one per retry.
  r = await bill(ownerToken, b.orderId, { priceOverride: [], seenPrice: [] });
  check('B4 several unknown keys -> 400 naming all of them',
    r.status === 400 && (r.body?.error?.message || '').includes('priceOverride') && (r.body?.error?.message || '').includes('seenPrice'),
    r.body?.error?.message);

  // B5 — empty override array, no PIN. Legitimate: nothing changed.
  r = await bill(ownerToken, b.orderId, { priceOverrides: [] });
  check('B5 empty priceOverrides + no pin -> 200 (nothing changed, nothing to authorise)', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  lines = await lineItemsOf(b.orderId);
  check('B5b every line billed at the untouched baseline 500', lines.every((l) => Number(l.billedUnitPrice) === 500), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));
  rows = await overrideRowsOf(b.orderId);
  check('B5c no OrderPriceOverride row written', rows.length === 0, `(${rows.length})`);

  // B6 — an override EXACTLY EQUAL to the baseline, no PIN. Owner decision 2026-09-25: a no-op.
  const cProduct = await makeArticle(ownerToken, stamp, 'C', { sellingPrice: 500 });
  const cBundle = await makeColorBundle(ownerToken, stamp, cProduct, 'C');
  const c = await createAndPackOrder(ownerToken, [[cBundle, 2]]);
  r = await bill(ownerToken, c.orderId, { priceOverrides: [{ productId: cProduct, unitPrice: 500 }] });
  check('B6 override equal to the baseline + no pin -> 200 (a genuine no-op)', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  rows = await overrideRowsOf(c.orderId);
  check('B6b no OrderPriceOverride row for a no-op', rows.length === 0, `(${rows.length})`);
  lines = await lineItemsOf(c.orderId);
  check('B6c billed at 500 as normal', lines.every((l) => Number(l.billedUnitPrice) === 500), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));

  // B7 — STAFF cannot reach this at all. The role gate fires before anything above.
  const dProduct = await makeArticle(ownerToken, stamp, 'D', { sellingPrice: 500 });
  const dBundle = await makeColorBundle(ownerToken, stamp, dProduct, 'D');
  const d = await createAndPackOrder(ownerToken, [[dBundle, 2]]);
  r = await api(`/api/orders/${d.orderId}/bill`, {
    method: 'PATCH', token: staffToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices: [], priceOverrides: [{ productId: dProduct, unitPrice: 1 }], pin: OWNER_PIN },
  });
  check('B7 STAFF -> 403 regardless of a correct PIN', r.status === 403, JSON.stringify(r.body));

  // =============================================================================================
  console.log('\n=== C. STALE PRICES ===');
  const eProduct = await makeArticle(ownerToken, stamp, 'E', { sellingPrice: 500 });
  const eBundle = await makeColorBundle(ownerToken, stamp, eProduct, 'E');
  const e = await createAndPackOrder(ownerToken, [[eBundle, 2]]);

  // The echo the owner would have approved, captured BEFORE anything changes.
  const staleEcho = await seenPricesFor(ownerToken, e.orderId);
  check('C0 the preview quotes the baseline 500', staleEcho.every((l) => l.unitPrice === 500), JSON.stringify(staleEcho));

  // Now move the baseline underneath it: opt the article in and give this location an override.
  await api(`/api/products/${eProduct}/location-pricing`, { method: 'PATCH', token: ownerToken, body: { hasLocationPricing: true } });
  await api(`/api/products/${eProduct}/location-prices/${created.locationId}`, {
    method: 'PUT', token: ownerToken, body: { sellingPrice: 550, pin: OWNER_PIN },
  });

  r = await api(`/api/orders/${e.orderId}/bill`, {
    method: 'PATCH', token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices: staleEcho },
  });
  check('C1 stale echo on an UNCHANGED line -> 409 PRICES_CHANGED', r.status === 409 && r.body?.error?.code === 'PRICES_CHANGED', JSON.stringify(r.body));
  // Order e has ONE line (one bundle, 2 sets) — createAndPackOrder(ownerToken, [[eBundle, 2]]) — so
  // exactly one line can have moved, not two.
  check('C2 the 409 names what moved, old and new', Array.isArray(r.body?.changedLines) && r.body.changedLines.length === 1 &&
    r.body.changedLines[0].lineItemId === e.lineItemIds[0] &&
    r.body.changedLines[0].shown === 500 && r.body.changedLines[0].current === 550, JSON.stringify(r.body?.changedLines));
  ord = await orderRow(e.orderId);
  check('C3 order still PACKED after a 409', ord.status === 'PACKED', `(${ord.status})`);

  // The same staleness while ALSO overriding — this is the case the guard really exists for: the
  // owner approved "500 -> 480", a 20 cut; against a moved baseline of 550 the same 480 would be a
  // 70 cut they never saw.
  r = await api(`/api/orders/${e.orderId}/bill`, {
    method: 'PATCH', token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices: staleEcho, priceOverrides: [{ productId: eProduct, unitPrice: 480 }], pin: OWNER_PIN },
  });
  check('C4 stale echo + an override -> 409, checked BEFORE the PIN is spent', r.status === 409 && r.body?.error?.code === 'PRICES_CHANGED', JSON.stringify(r.body));

  // Missing seenPrices entirely.
  r = await api(`/api/orders/${e.orderId}/bill`, {
    method: 'PATCH', token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  check('C5 seenPrices omitted -> 400 (required on every bill)', r.status === 400 && (r.body?.error?.message || '').includes('seenPrices'), JSON.stringify(r.body));

  // seenPrices naming a line that isn't on this order -> 400, not 409: re-previewing wouldn't fix it.
  r = await api(`/api/orders/${e.orderId}/bill`, {
    method: 'PATCH', token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false, seenPrices: [{ lineItemId: 'clnotarealline000000000000', unitPrice: 500 }] },
  });
  check('C6 seenPrices naming a foreign lineItemId -> 400', r.status === 400, JSON.stringify(r.body));

  // Re-preview and bill: now it goes through at the NEW baseline.
  r = await bill(ownerToken, e.orderId);
  check('C7 re-previewing then billing succeeds at the new baseline 550', r.status === 200 && Number(r.body?.preTaxAmount) === 1100, JSON.stringify(r.body?.preTaxAmount));

  // =============================================================================================
  console.log('\n=== D. PER-ARTICLE ACROSS COLOURS ===');
  const fProduct = await makeArticle(ownerToken, stamp, 'F', { sellingPrice: 500 });
  const fBundle1 = await makeColorBundle(ownerToken, stamp, fProduct, 'F1');
  const fBundle2 = await makeColorBundle(ownerToken, stamp, fProduct, 'F2');
  const fBundle3 = await makeColorBundle(ownerToken, stamp, fProduct, 'F3');
  const f = await createAndPackOrder(ownerToken, [[fBundle1, 1], [fBundle2, 1], [fBundle3, 1]]);
  r = await bill(ownerToken, f.orderId, { priceOverrides: [{ productId: fProduct, unitPrice: 400 }], pin: OWNER_PIN });
  check('D1 one override covers all three colours', r.status === 200, JSON.stringify(r.body).slice(0, 160));
  lines = await lineItemsOf(f.orderId);
  check('D2 all three lines billed at 400', lines.length === 3 && lines.every((l) => Number(l.billedUnitPrice) === 400), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));
  rows = await overrideRowsOf(f.orderId);
  check('D3 exactly ONE audit row for three lines (per-article grain)', rows.length === 1, `(${rows.length})`);

  // =============================================================================================
  console.log('\n=== E. MIXED BASELINES ACROSS ONE ARTICLE (owner decision 2026-09-25) ===');
  // Two colours of one article carrying DIFFERENT priceAtOrder values. Built the only way this can
  // really happen: place the order at 500, reprice the article to 520, then add the second colour
  // via PATCH /:id/lines, which re-snapshots priceAtOrder at the new figure.
  const gProduct = await makeArticle(ownerToken, stamp, 'G', { sellingPrice: 500 });
  const gBundle1 = await makeColorBundle(ownerToken, stamp, gProduct, 'G1');
  const gBundle2 = await makeColorBundle(ownerToken, stamp, gProduct, 'G2');
  const gOrd = await api('/api/orders', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: gBundle1, qtySetsRequested: 1 }] },
  });
  created.orderIds.push(gOrd.body.id);
  await api(`/api/products/${gProduct}`, { method: 'PATCH', token: ownerToken, body: { sellingPrice: 520, pin: OWNER_PIN } });
  r = await api(`/api/orders/${gOrd.body.id}/lines`, {
    method: 'PATCH', token: ownerToken,
    body: { newLines: [{ bundleId: gBundle2, qtySetsRequested: 1 }] },
  });
  check('E0 second colour added after the reprice', r.status === 200, JSON.stringify(r.body).slice(0, 160));
  const gDetail = await api(`/api/orders/${gOrd.body.id}`, { token: ownerToken });
  await api(`/api/orders/${gOrd.body.id}/pack`, {
    method: 'PATCH', token: ownerToken,
    body: { lineItems: gDetail.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  let gLines = await lineItemsOf(gOrd.body.id);
  const gPrices = gLines.map((l) => Number(l.priceAtOrder)).sort((x, y) => x - y);
  check('E1 the two lines really do carry different baselines (500 and 520)',
    gPrices.length === 2 && gPrices[0] === 500 && gPrices[1] === 520, JSON.stringify(gPrices));

  r = await bill(ownerToken, gOrd.body.id, { priceOverrides: [{ productId: gProduct, unitPrice: 480 }], pin: OWNER_PIN });
  check('E2 one override applies to both mixed-baseline lines', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  gLines = await lineItemsOf(gOrd.body.id);
  check('E3 both lines billed at 480', gLines.every((l) => Number(l.billedUnitPrice) === 480), JSON.stringify(gLines.map((l) => String(l.billedUnitPrice))));
  check('E4 preTaxAmount = 2 x 480 = 960, not a mix', Number(r.body?.preTaxAmount) === 960, `(${r.body?.preTaxAmount})`);
  rows = await overrideRowsOf(gOrd.body.id);
  check('E5 ONE row recording the RANGE: min 500, max 520, overridden 480', rows.length === 1 &&
    Number(rows[0].baselineMinUnitPrice) === 500 && Number(rows[0].baselineMaxUnitPrice) === 520 &&
    Number(rows[0].overriddenUnitPrice) === 480, JSON.stringify(rows[0]));

  // =============================================================================================
  console.log('\n=== F. VALIDATION ===');
  const hProduct = await makeArticle(ownerToken, stamp, 'H', { sellingPrice: 500, costPrice: 600 });
  const hBundle = await makeColorBundle(ownerToken, stamp, hProduct, 'H');
  const h = await createAndPackOrder(ownerToken, [[hBundle, 2]]);

  for (const [label, unitPrice, expectFragment] of [
    ['zero', 0, 'greater than 0'],
    ['negative', -1, 'greater than 0'],
    ['non-numeric', '480', 'finite number'],
    ['null', null, 'finite number'],
    ['three decimals', 480.125, 'decimal places'],
  ]) {
    r = await bill(ownerToken, h.orderId, { priceOverrides: [{ productId: hProduct, unitPrice }], pin: OWNER_PIN });
    check(`F1 ${label} unitPrice -> 400`, r.status === 400 && (r.body?.error?.message || '').includes(expectFragment), `${r.status} ${JSON.stringify(r.body)}`);
  }

  r = await bill(ownerToken, h.orderId, { priceOverrides: [{ productId: hProduct, unitPrice: 480 }, { productId: hProduct, unitPrice: 470 }], pin: OWNER_PIN });
  check('F2 duplicate productId -> 400, never last-wins', r.status === 400 && (r.body?.error?.message || '').includes('more than one entry'), JSON.stringify(r.body));

  r = await bill(ownerToken, h.orderId, { priceOverrides: [{ productId: aProduct, unitPrice: 480 }], pin: OWNER_PIN });
  check('F3 article not on this order -> 400 ARTICLE_NOT_ON_ORDER', r.status === 400 && r.body?.error?.code === 'ARTICLE_NOT_ON_ORDER', JSON.stringify(r.body));

  r = await bill(ownerToken, h.orderId, { priceOverrides: { [hProduct]: 480 }, pin: OWNER_PIN });
  check('F4 priceOverrides as an object, not an array -> 400', r.status === 400, JSON.stringify(r.body));

  // Two decimals ARE allowed — the boundary is exactly 2, and 480.25 must not be rejected by a
  // float-multiplication style check.
  r = await bill(ownerToken, h.orderId, { priceOverrides: [{ productId: hProduct, unitPrice: 480.25 }], pin: OWNER_PIN });
  check('F5 a two-decimal price is ACCEPTED', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  // costPrice on this article is 600 — the override of 480.25 is below cost and must still bill.
  check('F6 BELOW COST still bills (a warning, never a block)', r.status === 200 && Number(r.body?.preTaxAmount) === 960.5, `(${r.body?.preTaxAmount})`);

  // =============================================================================================
  console.log('\n=== G. DISCOUNT / GST / ROUNDING ON THE OVERRIDDEN PRICE ===');
  const iProduct = await makeArticle(ownerToken, stamp, 'I', { sellingPrice: 500 });
  const iBundle = await makeColorBundle(ownerToken, stamp, iProduct, 'I');
  const i = await createAndPackOrder(ownerToken, [[iBundle, 5]]);
  r = await bill(ownerToken, i.orderId, {
    priceOverrides: [{ productId: iProduct, unitPrice: 480 }],
    pin: OWNER_PIN,
    discountApplicable: true, discountPercent: 10,
    gstApplicable: true, gstPercent: 5,
  });
  // 5 x 480 = 2400; -10% = 2160; +5% = 2268. Every step exactly representable in float64, so these
  // are exact equalities rather than tolerances. The figures are worked out from rule 101's stated
  // order (discount first, GST on the post-discount amount) — never by calling the code under test.
  check('G1 preTaxAmount 2400 (from the OVERRIDE, not the 500 quote)', Number(r.body?.preTaxAmount) === 2400, `(${r.body?.preTaxAmount})`);
  check('G2 finalAmount 2160 after 10% discount', Number(r.body?.finalAmount) === 2160, `(${r.body?.finalAmount})`);
  check('G3 actualPayable 2268 after 5% GST on the post-discount figure', Number(r.body?.actualPayable) === 2268, `(${r.body?.actualPayable})`);

  // Rounding, on an overridden price. 3 x 480.5 = 1441.5, +5% GST = 1513.575 -> 1514.
  // Only the rounded integer is asserted: rule 109's exact roundingAdjustment arithmetic already
  // has its own dedicated coverage in test-order-rounding.mjs, and 1513.575 is not exactly
  // representable in float64 — asserting the delta here would be testing IEEE 754, not rule 113.
  const jProduct = await makeArticle(ownerToken, stamp, 'J', { sellingPrice: 500 });
  const jBundle = await makeColorBundle(ownerToken, stamp, jProduct, 'J');
  const j = await createAndPackOrder(ownerToken, [[jBundle, 3]]);
  r = await bill(ownerToken, j.orderId, {
    priceOverrides: [{ productId: jProduct, unitPrice: 480.5 }], pin: OWNER_PIN,
    gstApplicable: true, gstPercent: 5,
  });
  check('G4 preTaxAmount 1441.5 from a two-decimal override', Number(r.body?.preTaxAmount) === 1441.5, `(${r.body?.preTaxAmount})`);
  check('G5 actualPayable rounds to the whole rupee (1514)', Number(r.body?.actualPayable) === 1514, `(${r.body?.actualPayable})`);
  ord = await orderRow(j.orderId);
  check('G6 roundingAdjustment stored as a real non-zero figure', ord.roundingAdjustment !== null && Number(ord.roundingAdjustment) !== 0, `(${ord.roundingAdjustment})`);

  // =============================================================================================
  console.log('\n=== H. THE BILL SURVIVES A LATER SAVED-PRICE EDIT ===');
  // The audit row stores both numbers rather than re-deriving the baseline, so editing the
  // article's price afterwards must not change what History says happened.
  const beforeEdit = (await overrideRowsOf(a.orderId))[0];
  await api(`/api/products/${aProduct}`, { method: 'PATCH', token: ownerToken, body: { sellingPrice: 999, pin: OWNER_PIN } });
  await api(`/api/products/${aProduct}/location-pricing`, { method: 'PATCH', token: ownerToken, body: { hasLocationPricing: true } });
  await api(`/api/products/${aProduct}/location-prices/${created.locationId}`, {
    method: 'PUT', token: ownerToken, body: { sellingPrice: 777, pin: OWNER_PIN },
  });
  const afterEdit = (await overrideRowsOf(a.orderId))[0];
  check('H1 the audit row is byte-for-byte unchanged by a later reprice',
    Number(afterEdit.baselineMinUnitPrice) === Number(beforeEdit.baselineMinUnitPrice) &&
    Number(afterEdit.baselineMaxUnitPrice) === Number(beforeEdit.baselineMaxUnitPrice) &&
    Number(afterEdit.overriddenUnitPrice) === Number(beforeEdit.overriddenUnitPrice),
    JSON.stringify(afterEdit));
  lines = await lineItemsOf(a.orderId);
  check('H2 billedUnitPrice still 480, untouched by the reprice', lines.every((l) => Number(l.billedUnitPrice) === 480), JSON.stringify(lines.map((l) => String(l.billedUnitPrice))));
  ord = await orderRow(a.orderId);
  check('H3 the order total still 2400', Number(ord.preTaxAmount) === 2400, `(${ord.preTaxAmount})`);

  // =============================================================================================
  console.log('\n=== I. HISTORY (rule 104) ===');
  r = await api('/api/history', { token: ownerToken });
  const ownerEntries = r.body.filter((en) => en.type === 'PRICE_OVERRIDE');
  check('I1 OWNER sees a PRICE_OVERRIDE entry per changed article', ownerEntries.length >= 4, `(saw ${ownerEntries.length})`);
  const simpleEntry = ownerEntries.find((en) => en.description.includes(`BPO-A-${stamp}`));
  check('I2 equal-baseline entry reads "₹500 → ₹480"', !!simpleEntry && simpleEntry.description.includes('₹500 → ₹480'), simpleEntry?.description);
  check('I3 the entry says "at billing"', !!simpleEntry && simpleEntry.description.includes('at billing'), simpleEntry?.description);
  check('I4 actor is the OWNER who billed', !!simpleEntry && simpleEntry.actorRole === 'OWNER', simpleEntry?.actorRole);
  const rangeEntry = ownerEntries.find((en) => en.description.includes(`BPO-G-${stamp}`));
  check('I5 mixed-baseline entry renders the RANGE "₹500–₹520 → ₹480"',
    !!rangeEntry && rangeEntry.description.includes('₹500–₹520 → ₹480'), rangeEntry?.description);
  const noopEntry = ownerEntries.find((en) => en.description.includes(`BPO-C-${stamp}`));
  check('I6 the no-op bill produced NO entry at all', !noopEntry, noopEntry?.description);

  r = await api('/api/history', { token: staffToken });
  const staffSees = r.body.filter((en) => en.type === 'PRICE_OVERRIDE');
  check('I7 STAFF sees ZERO price-override entries (rule 104)', staffSees.length === 0, `(saw ${staffSees.length})`);
  check('I8 no trace of the overridden articles anywhere in the STAFF feed',
    !JSON.stringify(r.body).includes(`BPO-A-${stamp}`) && !JSON.stringify(r.body).includes('at billing'));

  // =============================================================================================
  console.log('\n=== J. PIN LOCKOUT (shared counters, not a second implementation) ===');
  // Run LAST, and on a THROWAWAY SECOND OWNER, never on the shared "owner" account: five wrong
  // attempts lock the account for 15 minutes, which would break every test file run after this one
  // — including a re-run of this one. The account is deleted in cleanup().
  const lockUsername = `probe_bpo_owner_${stamp}`;
  const lockPassword = 'ProbeOwner!2026';
  r = await api('/api/users', {
    method: 'POST', token: ownerToken,
    body: { username: lockUsername, password: lockPassword, name: 'BPO Probe Owner', role: 'OWNER' },
  });
  if (!r.body?.id) throw new Error(`Second owner creation failed: ${JSON.stringify(r.body)}`);
  created.lockoutOwnerId = r.body.id;
  const lockToken = await login(lockUsername, lockPassword);
  // First-time PIN setup needs no currentPin (rule 73 — a PIN is exclusively self-service).
  r = await api('/api/users/me/pin', { method: 'PATCH', token: lockToken, body: { newPin: '654321' } });
  check('J0 second owner set its own PIN', r.status === 200, JSON.stringify(r.body));

  const kProduct = await makeArticle(ownerToken, stamp, 'K', { sellingPrice: 500 });
  const kBundle = await makeColorBundle(ownerToken, stamp, kProduct, 'K');
  const k = await createAndPackOrder(ownerToken, [[kBundle, 1]]);

  let lastStatus = null;
  let lastCode = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const resp = await bill(lockToken, k.orderId, { priceOverrides: [{ productId: kProduct, unitPrice: 400 }], pin: '000000' });
    lastStatus = resp.status;
    lastCode = resp.body?.error?.code;
  }
  check('J1 the fifth consecutive wrong PIN locks the account', lastStatus === 403 && lastCode === 'PIN_LOCKED', `${lastStatus} ${lastCode}`);
  // Even the CORRECT PIN is refused while locked — proving the lockout is the shared one from
  // middleware/requirePin.js, not a counter this endpoint keeps for itself.
  r = await bill(lockToken, k.orderId, { priceOverrides: [{ productId: kProduct, unitPrice: 400 }], pin: '654321' });
  check('J2 the correct PIN is refused while locked out', r.status === 403 && r.body?.error?.code === 'PIN_LOCKED', JSON.stringify(r.body));
  ord = await orderRow(k.orderId);
  check('J3 order never billed through any of it', ord.status === 'PACKED', `(${ord.status})`);
  // A bill with NO price change still goes through while the PIN is locked — the gate is
  // conditional, and a locked PIN must not block ordinary billing.
  r = await bill(lockToken, k.orderId);
  check('J4 an unchanged-price bill still succeeds during a PIN lockout', r.status === 200, JSON.stringify(r.body).slice(0, 200));

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
