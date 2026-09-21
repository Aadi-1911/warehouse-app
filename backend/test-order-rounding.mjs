// Real, persisted test for rule 109 — whole-rupee rounding of Order.actualPayable, with the
// rounding recorded explicitly in Order.roundingAdjustment rather than silently absorbed. Same file
// convention as test-order-billing-correction.mjs / test-transfer-idempotency.mjs (flat .mjs under
// backend/, refuse-to-fall-back TEST_DATABASE_URL guard, convergent FK-safe cleanup).
//
// WHAT THIS PROVES, and why the expected numbers below are hard-coded rather than recomputed:
// every assertion compares against a figure worked out independently of the code under test. If the
// expectations called computeBillingAmounts() they would agree with a broken implementation by
// construction, which for money arithmetic is worse than no test at all. The values come from the
// plain arithmetic rule 109 defines — discount off pre-tax, GST on the post-discount figure, then
// Math.round to the rupee — e.g. 46320 −6.045% = 43519.956, +5% = 45695.9538, rounds to 45696 with
// an adjustment of +0.0462. That case is not invented: it is the exact shape of a real Production
// order (cmu3rbshr, Arora Garments), reproduced here.
//
// The rounding direction on a tie is the specific thing scenario C exists to pin down. Math.round
// rounds half UP (1060.5 -> 1061), matching Excel's ROUND(), NOT banker's/half-to-even rounding
// (which would give 1060). A future refactor to a decimal library would be very likely to change
// this silently, since several of them default to half-even — this test would fail loudly.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-order-rounding.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file makes its own direct Prisma queries (reading the stored Decimal columns back is the
// whole point, and scenario E has to WRITE a pre-rule-109 row the current code can no longer
// produce), so it applies the same refuse-to-fall-back guard before any @prisma/client import.
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
  productIds: [],
  colorIds: [],
  bundleIds: [],
  orderIds: [],
};

// Convergent cleanup by reference, same discipline as the sibling test files. FK order derived from
// the real ON DELETE constraints: OrderBillingCorrection/OrderAdjustment/OrderLineItem all point AT
// Order and must go first; Transaction points at Stock, which points at Bundle.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.orderIds.length) {
      await p.orderBillingCorrection.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderAdjustment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await p.orderLineItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
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
    console.log('  deleted corrections/adjustments/line items/transactions/orders/stock/bundles/products/colors/party/factory/location');
  } finally {
    await p.$disconnect();
  }
}

// One article whose sellingPrice is chosen so that qtySets x price lands on an exact preTaxAmount.
// piecesPerSet is 1 here (a single non-kids size with qty 1), so preTaxAmount = qtySets x price
// exactly — that is what makes the hard-coded expectations below arithmetic rather than guesswork.
async function makeBilledOrder(ownerToken, stamp, label, { sellingPrice, qtySets, discountApplicable, discountPercent, gstApplicable, gstPercent }) {
  const prod = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `RND-${label}-${stamp}`,
      name: `Rounding ${label} ${stamp}`,
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
      costPrice: 1,
      sellingPrice,
      pin: OWNER_PIN,
    },
  });
  if (!prod.body?.id) throw new Error(`Product creation failed (${label}): ${JSON.stringify(prod.body)}`);
  created.productIds.push(prod.body.id);

  const col = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `RndCol-${label}-${stamp}` } });
  if (!col.body?.id) throw new Error(`Color creation failed (${label}): ${JSON.stringify(col.body)}`);
  created.colorIds.push(col.body.id);

  const bun = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId: prod.body.id, colorId: col.body.id } });
  if (!bun.body?.id) throw new Error(`Bundle creation failed (${label}): ${JSON.stringify(bun.body)}`);
  created.bundleIds.push(bun.body.id);

  const stockIn = await api('/api/transactions', {
    method: 'POST',
    token: ownerToken,
    body: { bundleId: bun.body.id, locationId: created.locationId, type: 'STOCK_IN', qtySets },
  });
  if (stockIn.status !== 201) throw new Error(`Stock-in failed (${label}): ${JSON.stringify(stockIn.body)}`);

  const ord = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: bun.body.id, qtySetsRequested: qtySets }] },
  });
  if (!ord.body?.id) throw new Error(`Order creation failed (${label}): ${JSON.stringify(ord.body)}`);
  created.orderIds.push(ord.body.id);

  const packed = await api(`/api/orders/${ord.body.id}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: ord.body.lineItems.map((li) => ({ lineItemId: li.id, qtySetsPacked: li.qtySetsRequested })) },
  });
  if (packed.status !== 200) throw new Error(`Pack failed (${label}): ${JSON.stringify(packed.body)}`);

  const billed = await api(`/api/orders/${ord.body.id}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable, discountPercent, gstApplicable, gstPercent },
  });
  if (billed.status !== 200) throw new Error(`Bill failed (${label}): ${JSON.stringify(billed.body)}`);

  return { orderId: ord.body.id, billResponse: billed.body };
}

// Reads the columns straight out of Postgres rather than trusting the API response — the stored
// value is the thing rule 109 is actually about.
async function storedBilling(orderId) {
  const p = await db();
  const row = await p.order.findUnique({
    where: { id: orderId },
    select: { preTaxAmount: true, finalAmount: true, actualPayable: true, roundingAdjustment: true },
  });
  return {
    preTaxAmount: row.preTaxAmount === null ? null : Number(row.preTaxAmount),
    finalAmount: row.finalAmount === null ? null : Number(row.finalAmount),
    actualPayable: row.actualPayable === null ? null : Number(row.actualPayable),
    roundingAdjustment: row.roundingAdjustment === null ? null : Number(row.roundingAdjustment),
    raw: row,
  };
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();

  console.log('\n=== SETUP: isolated factory / location / party / category ===');
  let r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `RndFactory-${stamp}` } });
  if (!r.body?.id) throw new Error(`Factory creation failed: ${JSON.stringify(r.body)}`);
  created.factoryId = r.body.id;

  r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `RndLoc-${stamp}` } });
  if (!r.body?.id) throw new Error(`Location creation failed: ${JSON.stringify(r.body)}`);
  created.locationId = r.body.id;

  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `RndParty-${stamp}`, state: 'MAHARASHTRA' } });
  if (!r.body?.id) throw new Error(`Party creation failed: ${JSON.stringify(r.body)}`);
  created.partyId = r.body.id;

  const categories = await api('/api/categories', { token: ownerToken });
  created.categoryId = categories.body[0]?.id;
  if (!created.categoryId) throw new Error('No Category exists on the test branch — cannot create a Product.');

  // --- A: control. GST only, no discount, raw figure already whole. -------------------------
  // 2000 + 5% = 2100 exactly. Nothing to round, so the adjustment must be exactly 0 — NOT null,
  // which would mean "no rounding was recorded" and is reserved for pre-rule-109 orders.
  console.log('\n=== A. Control: GST only, lands cleanly (2000 +5% = 2100) ===');
  const a = await makeBilledOrder(ownerToken, stamp, 'A', {
    sellingPrice: 200, qtySets: 10, discountApplicable: false, discountPercent: null, gstApplicable: true, gstPercent: 5,
  });
  const aStored = await storedBilling(a.orderId);
  check('A preTaxAmount stored 2000', aStored.preTaxAmount === 2000, `got ${aStored.preTaxAmount}`);
  check('A finalAmount stored 2000 (no discount)', aStored.finalAmount === 2000, `got ${aStored.finalAmount}`);
  check('A actualPayable stored 2100', aStored.actualPayable === 2100, `got ${aStored.actualPayable}`);
  check('A roundingAdjustment stored exactly 0, not null', aStored.roundingAdjustment === 0, `got ${aStored.roundingAdjustment}`);
  check('A API response echoes roundingAdjustment 0', Number(a.billResponse.roundingAdjustment) === 0, `got ${a.billResponse.roundingAdjustment}`);

  // --- B: the real Production shape. ---------------------------------------------------------
  // 46320 −6.045% = 43519.956 ; +5% = 45695.9538 ; rounds to 45696, adjustment +0.0462.
  // This is order cmu3rbshr's exact arithmetic, which Production currently stores unrounded.
  console.log('\n=== B. Production shape: 46320, discount 6.045%, GST 5% ===');
  const b = await makeBilledOrder(ownerToken, stamp, 'B', {
    sellingPrice: 4632, qtySets: 10, discountApplicable: true, discountPercent: 6.045, gstApplicable: true, gstPercent: 5,
  });
  const bStored = await storedBilling(b.orderId);
  check('B preTaxAmount stored 46320', bStored.preTaxAmount === 46320, `got ${bStored.preTaxAmount}`);
  check('B finalAmount stored 43519.956 UNROUNDED', bStored.finalAmount === 43519.956, `got ${bStored.finalAmount}`);
  check('B actualPayable stored 45696 (rounded from 45695.9538)', bStored.actualPayable === 45696, `got ${bStored.actualPayable}`);
  check('B roundingAdjustment stored +0.0462', bStored.roundingAdjustment === 0.0462, `got ${bStored.roundingAdjustment}`);
  // The invariant that makes the adjustment worth storing at all: the raw figure is recoverable.
  check(
    'B actualPayable - roundingAdjustment recovers the raw 45695.9538',
    Math.abs((bStored.actualPayable - bStored.roundingAdjustment) - 45695.9538) < 1e-9,
    `got ${bStored.actualPayable - bStored.roundingAdjustment}`
  );
  // Guards the thing a Decimal column silently allows: 17 digits of float artefact.
  check(
    'B roundingAdjustment stored clean, not float noise',
    bStored.raw.roundingAdjustment.toString() === '0.0462',
    `got "${bStored.raw.roundingAdjustment.toString()}"`
  );

  // --- C1: exact .5, the tie case. -----------------------------------------------------------
  // 1010 + 5% = 1060.5 exactly. Half-up (Excel ROUND) gives 1061; banker's would give 1060.
  console.log('\n=== C1. Exact .5 tie: 1010 +5% = 1060.5 (must round UP, half-up not banker\'s) ===');
  const c1 = await makeBilledOrder(ownerToken, stamp, 'C1', {
    sellingPrice: 101, qtySets: 10, discountApplicable: false, discountPercent: null, gstApplicable: true, gstPercent: 5,
  });
  const c1Stored = await storedBilling(c1.orderId);
  check('C1 raw figure was exactly 1060.5 (preTax 1010)', c1Stored.preTaxAmount === 1010, `got ${c1Stored.preTaxAmount}`);
  check('C1 actualPayable rounded UP to 1061 (half-up)', c1Stored.actualPayable === 1061, `got ${c1Stored.actualPayable}`);
  check('C1 NOT 1060 — confirms this is not banker\'s rounding', c1Stored.actualPayable !== 1060, `got ${c1Stored.actualPayable}`);
  check('C1 roundingAdjustment stored +0.5', c1Stored.roundingAdjustment === 0.5, `got ${c1Stored.roundingAdjustment}`);

  // --- C2: rounding DOWN, producing a negative adjustment. -----------------------------------
  // 1000 + 4.43% = 1044.3 ; rounds to 1044, adjustment −0.3. The sign convention matters: negative
  // means the party was rounded down (charged less than the raw arithmetic).
  console.log('\n=== C2. Rounds DOWN: 1000 +4.43% = 1044.3 -> 1044, adjustment negative ===');
  const c2 = await makeBilledOrder(ownerToken, stamp, 'C2', {
    sellingPrice: 100, qtySets: 10, discountApplicable: false, discountPercent: null, gstApplicable: true, gstPercent: 4.43,
  });
  const c2Stored = await storedBilling(c2.orderId);
  check('C2 actualPayable rounded DOWN to 1044', c2Stored.actualPayable === 1044, `got ${c2Stored.actualPayable}`);
  check('C2 roundingAdjustment stored -0.3 (negative)', c2Stored.roundingAdjustment === -0.3, `got ${c2Stored.roundingAdjustment}`);
  check('C2 sign is genuinely negative', c2Stored.roundingAdjustment < 0, `got ${c2Stored.roundingAdjustment}`);

  // --- D: correction on a freshly-billed (already-rounded) order. ----------------------------
  // Billed at 2000 +5% = 2100 (adj 0), then corrected to add a 3.3% discount:
  // 2000 −3.3% = 1934 ; +5% = 2030.7 ; rounds to 2031, adjustment +0.3.
  console.log('\n=== D. Correction on a freshly-billed, already-rounded order ===');
  const d = await makeBilledOrder(ownerToken, stamp, 'D', {
    sellingPrice: 200, qtySets: 10, discountApplicable: false, discountPercent: null, gstApplicable: true, gstPercent: 5,
  });
  const dBefore = await storedBilling(d.orderId);
  check('D before correction: actualPayable 2100, adjustment 0', dBefore.actualPayable === 2100 && dBefore.roundingAdjustment === 0, JSON.stringify(dBefore));

  r = await api(`/api/orders/${d.orderId}/billing-correction`, {
    method: 'PATCH',
    token: ownerToken,
    body: { discountApplicable: true, discountPercent: 3.3, gstApplicable: true, gstPercent: 5, reason: 'DISCOUNT_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  check('D correction returns 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  const dAfter = await storedBilling(d.orderId);
  check('D after correction: finalAmount 1934 unrounded', dAfter.finalAmount === 1934, `got ${dAfter.finalAmount}`);
  check('D after correction: actualPayable 2031 (rounded from 2030.7)', dAfter.actualPayable === 2031, `got ${dAfter.actualPayable}`);
  check('D after correction: roundingAdjustment +0.3', dAfter.roundingAdjustment === 0.3, `got ${dAfter.roundingAdjustment}`);

  const p = await db();
  const dCorrection = await p.orderBillingCorrection.findFirst({ where: { orderId: d.orderId }, orderBy: { createdAt: 'desc' } });
  check('D audit row: oldActualPayable 2100', Number(dCorrection.oldActualPayable) === 2100, `got ${dCorrection.oldActualPayable}`);
  check('D audit row: oldRoundingAdjustment 0 (was already rounded)', Number(dCorrection.oldRoundingAdjustment) === 0, `got ${dCorrection.oldRoundingAdjustment}`);
  check('D audit row: newActualPayable 2031', Number(dCorrection.newActualPayable) === 2031, `got ${dCorrection.newActualPayable}`);
  check('D audit row: newRoundingAdjustment +0.3', Number(dCorrection.newRoundingAdjustment) === 0.3, `got ${dCorrection.newRoundingAdjustment}`);

  // --- E: correction on a PRE-RULE-109 order. ------------------------------------------------
  // The current code can no longer produce an unrounded billed order, so the row is written
  // directly to recreate the real Production shape (order cmu3rbshr: finalAmount 43519.956,
  // actualPayable 45695.9538, roundingAdjustment null). This is a deliberate test fixture, not a
  // shortcut — it is the only way to exercise the null-going-in path this field introduces.
  //
  // Correcting to 3.017% discount: 46320 −3.017% = 44922.5256 ; +5% = 47168.65188 ; rounds to
  // 47169, adjustment +0.34812.
  console.log('\n=== E. Correction on an order billed BEFORE this field existed (null going in) ===');
  const e = await makeBilledOrder(ownerToken, stamp, 'E', {
    sellingPrice: 4632, qtySets: 10, discountApplicable: true, discountPercent: 6.045, gstApplicable: true, gstPercent: 5,
  });
  await p.order.update({
    where: { id: e.orderId },
    data: { finalAmount: 43519.956, actualPayable: 45695.9538, roundingAdjustment: null },
  });
  const eBefore = await storedBilling(e.orderId);
  check('E fixture: actualPayable is unrounded 45695.9538', eBefore.actualPayable === 45695.9538, `got ${eBefore.actualPayable}`);
  check('E fixture: roundingAdjustment is null (pre-rule-109)', eBefore.roundingAdjustment === null, `got ${eBefore.roundingAdjustment}`);

  r = await api(`/api/orders/${e.orderId}/billing-correction`, {
    method: 'PATCH',
    token: ownerToken,
    body: { discountApplicable: true, discountPercent: 3.017, gstApplicable: true, gstPercent: 5, reason: 'DISCOUNT_PERCENT_CORRECTED', pin: OWNER_PIN },
  });
  check('E correction returns 200 (does not error on the null)', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  const eAfter = await storedBilling(e.orderId);
  check('E after correction: actualPayable 47169 (now rounded)', eAfter.actualPayable === 47169, `got ${eAfter.actualPayable}`);
  check('E after correction: roundingAdjustment +0.34812 (now recorded)', eAfter.roundingAdjustment === 0.34812, `got ${eAfter.roundingAdjustment}`);
  check('E after correction: actualPayable is a whole rupee', Number.isInteger(eAfter.actualPayable), `got ${eAfter.actualPayable}`);

  const eCorrection = await p.orderBillingCorrection.findFirst({ where: { orderId: e.orderId }, orderBy: { createdAt: 'desc' } });
  check('E audit row: oldActualPayable 45695.9538 (the unrounded original)', Number(eCorrection.oldActualPayable) === 45695.9538, `got ${eCorrection.oldActualPayable}`);
  check('E audit row: oldRoundingAdjustment is NULL, not 0', eCorrection.oldRoundingAdjustment === null, `got ${eCorrection.oldRoundingAdjustment}`);
  check('E audit row: newRoundingAdjustment +0.34812', Number(eCorrection.newRoundingAdjustment) === 0.34812, `got ${eCorrection.newRoundingAdjustment}`);

  // --- F: forward-only, verified rather than asserted. ---------------------------------------
  // A second pre-rule-109 row that NOTHING corrects. Real billing and a real correction both run
  // against other orders afterwards; this row must come back byte-identical. A rule that only
  // claimed to be forward-only would pass every test above and still fail this one.
  console.log('\n=== F. Forward-only: an untouched pre-rule-109 order is never rewritten ===');
  const f = await makeBilledOrder(ownerToken, stamp, 'F', {
    sellingPrice: 4632, qtySets: 10, discountApplicable: true, discountPercent: 6.045, gstApplicable: true, gstPercent: 5,
  });
  await p.order.update({
    where: { id: f.orderId },
    data: { finalAmount: 43519.956, actualPayable: 45695.9538, roundingAdjustment: null },
  });
  const fSnapshot = await p.order.findUnique({
    where: { id: f.orderId },
    select: { preTaxAmount: true, finalAmount: true, actualPayable: true, roundingAdjustment: true, discountPercent: true, gstPercent: true },
  });
  const fSnapshotJson = JSON.stringify(fSnapshot);

  // Real activity elsewhere, after the snapshot: a fresh billing and a fresh correction.
  const g = await makeBilledOrder(ownerToken, stamp, 'G', {
    sellingPrice: 101, qtySets: 10, discountApplicable: false, discountPercent: null, gstApplicable: true, gstPercent: 5,
  });
  check('F guard: the unrelated order G billed normally (1061)', (await storedBilling(g.orderId)).actualPayable === 1061, 'G did not bill as expected');
  r = await api(`/api/orders/${d.orderId}/billing-correction`, {
    method: 'PATCH',
    token: ownerToken,
    body: { discountApplicable: true, discountPercent: 3.3, gstApplicable: true, gstPercent: 5, reason: 'RECONFIRMED_NO_CHANGE', pin: OWNER_PIN },
  });
  check('F guard: an unrelated correction also ran', r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
  // Reading the order through the API too — a GET must not lazily "fix up" a legacy row either.
  await api(`/api/orders/${f.orderId}`, { token: ownerToken });

  const fAfter = await p.order.findUnique({
    where: { id: f.orderId },
    select: { preTaxAmount: true, finalAmount: true, actualPayable: true, roundingAdjustment: true, discountPercent: true, gstPercent: true },
  });
  check('F untouched order is byte-identical after other billing/corrections/reads', JSON.stringify(fAfter) === fSnapshotJson, `before ${fSnapshotJson} after ${JSON.stringify(fAfter)}`);
  check('F untouched order still holds the UNROUNDED 45695.9538', Number(fAfter.actualPayable) === 45695.9538, `got ${fAfter.actualPayable}`);
  check('F untouched order still has null roundingAdjustment', fAfter.roundingAdjustment === null, `got ${fAfter.roundingAdjustment}`);
}

main()
  .catch((err) => {
    console.error('\nSCRIPT ERROR:', err);
    fail++;
    failures.push('script threw');
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
    if (failures.length) {
      console.log('Failures:', failures.join(', '));
      process.exit(1);
    }
  });
