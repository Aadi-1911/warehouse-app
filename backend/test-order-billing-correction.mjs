// Real, persisted test for rule 105 — PATCH /api/orders/:id/billing-correction and its
// GET /api/history rendering. Named test-<feature>.mjs and living flat under backend/, matching
// every prior "real test file" this project's LEARNING_LOG.md describes (test-inline-create.mjs,
// test-product-name.mjs, test-schema-migration.mjs, etc.) — none of which were ever actually
// committed to git (confirmed directly: `git log --all --diff-filter=A -- '*test*.mjs'` returns
// nothing, on any branch, in this repo's entire history). This file is the first one that is.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-order-billing-correction.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset — so there is no way to point
// this file at the real dev database by omission. Billing an order is irreversible.
//
// Every fixture this file creates (Location, Party, Factory, Category, Color, Product, Bundle,
// Stock, Transactions, Orders and their line items/adjustments, and every OrderBillingCorrection
// row) is deleted in a `finally` block in real FK-safe order — the exact discipline this project's
// own log names as the difference between "a lasting fixture" and a script that leaves orphaned
// rows for the next run to trip over.

// This file makes two independent kinds of database access: every check above goes through the
// server at BASE, which already points itself at TEST_DATABASE_URL via server.js's own
// NODE_ENV=test guard. But the no-op assertions and cleanup() below construct their OWN
// PrismaClient, in THIS process — and this process never ran through that guard. Left alone that
// client would read plain DATABASE_URL from .env, i.e. the real DEV database, silently: exactly
// what happened on first run here, when the no-op check queried dev, found nothing, and crashed
// on a null row. Fixed the same way server.js fixes it for itself — override DATABASE_URL in this
// process before any `@prisma/client` import, with the identical refuse-to-fall-back guard.
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

// Fails LOUDLY on a bad login rather than returning undefined for the caller to silently treat as
// "skip this check" — the exact bug fixed here (2026-09-08). A login that doesn't return a real
// token throws immediately, with the real response body attached, so a credential/seed-data
// problem surfaces as a crashed test run, never as a quietly-shrunk assertion count.
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

const created = {
  orderIds: [],
  locationId: null,
  partyId: null,
  factoryId: null,
  categoryId: null,
  colorId: null,
  productId: null,
  bundleId: null,
};

async function cleanup() {
  console.log('\n=== CLEANUP ===');
  // FK-safe order: OrderBillingCorrection/OrderAdjustment/Transaction/OrderLineItem all reference
  // Order (directly or via Stock/OrderLineItem), so every Order must be deleted last among the
  // order-family rows and before the catalogue rows (Bundle/Product/Factory/Category/Color/
  // Location/Party) they in turn reference. No API endpoint exists to hard-delete an Order, so
  // this goes directly through Prisma, matching the direct-DB cleanup this project's own prior
  // wipe tasks already established for exactly this situation.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (created.orderIds.length) {
      await prisma.orderBillingCorrection.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.orderAdjustment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.transaction.deleteMany({ where: { orderLineItem: { orderId: { in: created.orderIds } } } });
      await prisma.orderLineItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      const del = await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
      console.log(`  deleted ${del.count} orders and their line items/adjustments/corrections`);
    }
    if (created.bundleId) {
      await prisma.transaction.deleteMany({ where: { stock: { bundleId: created.bundleId } } });
      await prisma.stock.deleteMany({ where: { bundleId: created.bundleId } });
      await prisma.bundle.delete({ where: { id: created.bundleId } }).catch(() => {});
      console.log('  deleted stock/transactions/bundle');
    }
    if (created.productId) {
      // ProductSize rows block a direct Product delete (RESTRICT) — found the hard way running
      // this exact cleanup logic by hand before this file existed: `product.deleteMany()` failed
      // with a real Postgres 23001 error naming `ProductSize_productId_fkey`.
      await prisma.productSize.deleteMany({ where: { productId: created.productId } });
      await prisma.product.delete({ where: { id: created.productId } }).catch(() => {});
    }
    if (created.partyId) await prisma.party.delete({ where: { id: created.partyId } }).catch(() => {});
    if (created.locationId) await prisma.location.delete({ where: { id: created.locationId } }).catch(() => {});
    if (created.factoryId) await prisma.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    if (created.categoryId) await prisma.category.delete({ where: { id: created.categoryId } }).catch(() => {});
    if (created.colorId) await prisma.color.delete({ where: { id: created.colorId } }).catch(() => {});
    console.log('  deleted product/party/location/factory/category/colour');
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  // Fails LOUDLY now (item 4) — no try/catch swallowing this into `null`, no `if (staffToken)`
  // guard skipping the assertions below. If this account doesn't exist or the password is wrong,
  // the whole run aborts with a clear error instead of quietly reporting all-pass with zero STAFF
  // coverage.
  const staffToken = await login('probe_billno_staff', 'ProbeStaff!2026');

  console.log('\n=== SETUP: seed a real billable order on the TEST branch ===');
  const stamp = Date.now();

  let r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `BCTest-${stamp}` } });
  created.locationId = r.body.id;
  console.log('  location:', created.locationId, r.status);

  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `BCParty-${stamp}` } });
  created.partyId = r.body.id;
  console.log('  party:', created.partyId, r.status);

  r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `BCFac-${stamp}` } });
  created.factoryId = r.body.id;
  r = await api('/api/categories', { method: 'POST', token: ownerToken, body: { name: `BCCat-${stamp}` } });
  created.categoryId = r.body.id;
  r = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `BCCol-${stamp}` } });
  created.colorId = r.body.id;

  r = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      articleNo: `BC${stamp}`,
      factoryId: created.factoryId,
      name: 'Billing Correction Test',
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', qty: 1 }],
      costPrice: 100,
      sellingPrice: 200,
      pin: OWNER_PIN,
    },
  });
  created.productId = r.body.id;
  console.log('  product:', created.productId, r.status, r.status !== 201 ? JSON.stringify(r.body) : '');

  r = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId: created.productId, colorId: created.colorId } });
  created.bundleId = r.body.id;
  console.log('  bundle:', created.bundleId, r.status);

  r = await api('/api/transactions', {
    method: 'POST',
    token: ownerToken,
    body: { bundleId: created.bundleId, locationId: created.locationId, type: 'STOCK_IN', qtySets: 50 },
  });
  console.log('  stock in:', r.status);

  r = await api('/api/orders', {
    method: 'POST',
    token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: created.bundleId, qtySetsRequested: 10 }] },
  });
  const orderId = r.body.id;
  created.orderIds.push(orderId);
  const lineItemId = r.body.lineItems[0].id;
  console.log('  order:', orderId, r.status);

  r = await api(`/api/orders/${orderId}/pack`, {
    method: 'PATCH',
    token: ownerToken,
    body: { lineItems: [{ lineItemId, qtySetsPacked: 10 }] },
  });
  console.log('  packed:', r.status);

  r = await api(`/api/orders/${orderId}/bill`, {
    method: 'PATCH',
    token: ownerToken,
    body: { locationId: created.locationId, locationConfirmed: true, discountApplicable: false, gstApplicable: false },
  });
  console.log('  billed:', r.status, 'preTax=', r.body.preTaxAmount, 'actualPayable=', r.body.actualPayable);
  const billedPreTax = Number(r.body.preTaxAmount);
  check('billed with no GST/discount: actualPayable === preTaxAmount', Number(r.body.actualPayable) === billedPreTax,
    `(${r.body.actualPayable} vs ${billedPreTax})`);

  console.log('\n=== REJECTION PATHS ===');

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'GST_ADDED_RETROACTIVELY' },
  });
  check('403 without PIN', r.status === 403 && r.body.error?.code === 'MISSING_PIN', JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'GST_ADDED_RETROACTIVELY', pin: '999999' },
  });
  check('403 with wrong PIN', r.status === 403 && r.body.error?.code === 'INVALID_PIN', JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: staffToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'GST_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  check('403 for STAFF role', r.status === 403, JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 18, reason: 'GST_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  check('400 gstPercent > 5', r.status === 400 && /gstPercent/.test(r.body.error?.message || ''), JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { discountApplicable: true, discountPercent: -5, reason: 'DISCOUNT_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  check('400 discountPercent < 0', r.status === 400, JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'NOT_A_REASON', pin: OWNER_PIN },
  });
  check('400 invalid reason', r.status === 400 && /reason must be one of/.test(r.body.error?.message || ''), JSON.stringify(r.body));

  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'OTHER', pin: OWNER_PIN },
  });
  check('400 OTHER without note', r.status === 400 && /note is required/.test(r.body.error?.message || ''), JSON.stringify(r.body));

  r = await api('/api/orders', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, lineItems: [{ bundleId: created.bundleId, qtySetsRequested: 1 }] },
  });
  const unbilledId = r.body.id;
  created.orderIds.push(unbilledId);
  r = await api(`/api/orders/${unbilledId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'GST_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  check('409 on never-billed order', r.status === 409 && r.body.error?.code === 'ORDER_NOT_BILLED', JSON.stringify(r.body));

  // A genuine change claimed as RECONFIRMED_NO_CHANGE — the inverse-mistake guard added alongside
  // the no-op override (2026-09-08): the server must catch a dishonest "nothing changed" claim,
  // not just detect real no-ops.
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'RECONFIRMED_NO_CHANGE', pin: OWNER_PIN },
  });
  check('400 RECONFIRMED_NO_CHANGE rejected when values actually differ', r.status === 400 && /differ/.test(r.body.error?.message || ''), JSON.stringify(r.body));

  console.log('\n=== HAPPY PATH 1: add GST retroactively (amount INCREASES) ===');
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 5, reason: 'GST_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  const expected1 = billedPreTax + (billedPreTax * 5) / 100;
  console.log('  status', r.status, 'actualPayable=', r.body.actualPayable, 'expected=', expected1);
  check('200 and GST flag flipped false -> true', r.status === 200 && r.body.gstApplicable === true, JSON.stringify(r.body).slice(0, 200));
  check('actualPayable increased to preTax + 5%', Number(r.body.actualPayable) === expected1, `(${r.body.actualPayable} vs ${expected1})`);
  check('preTaxAmount UNCHANGED', Number(r.body.preTaxAmount) === billedPreTax, `(${r.body.preTaxAmount})`);
  check('finalAmount still preTax (no discount)', Number(r.body.finalAmount) === billedPreTax, `(${r.body.finalAmount})`);

  console.log('\n=== HAPPY PATH 2: correct the GST rate 5% -> 3% ===');
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { gstApplicable: true, gstPercent: 3, reason: 'GST_PERCENT_CORRECTED', pin: OWNER_PIN },
  });
  const expected2 = billedPreTax + (billedPreTax * 3) / 100;
  check('second correction on same order allowed (orderId not unique)', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  check('actualPayable recomputed for 3%', Number(r.body.actualPayable) === expected2, `(${r.body.actualPayable} vs ${expected2})`);

  console.log('\n=== HAPPY PATH 3: add discount too — amount can go DOWN (rule 103) ===');
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { discountApplicable: true, discountPercent: 10, gstApplicable: true, gstPercent: 3, reason: 'DISCOUNT_ADDED_RETROACTIVELY', pin: OWNER_PIN },
  });
  const expFinal3 = billedPreTax - (billedPreTax * 10) / 100;
  const expPayable3 = expFinal3 + (expFinal3 * 3) / 100;
  check('discount+GST applied in the right ORDER (GST on post-discount)',
    Number(r.body.finalAmount) === expFinal3 && Number(r.body.actualPayable) === expPayable3,
    `final ${r.body.finalAmount} vs ${expFinal3}, payable ${r.body.actualPayable} vs ${expPayable3}`);
  check('amount is now LOWER than pre-tax (discount outweighs GST)', Number(r.body.actualPayable) < billedPreTax, `(${r.body.actualPayable} vs ${billedPreTax})`);

  console.log('\n=== HAPPY PATH 4: remove GST entirely (flag true -> false) ===');
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { discountApplicable: true, discountPercent: 10, gstApplicable: false, reason: 'OTHER', note: 'party is unregistered', pin: OWNER_PIN },
  });
  check('GST flag flipped true -> false', r.status === 200 && r.body.gstApplicable === false, JSON.stringify(r.body).slice(0, 160));
  check('gstPercent nulled when flag false', r.body.gstPercent === null, `(${r.body.gstPercent})`);
  check('actualPayable === finalAmount with no GST', Number(r.body.actualPayable) === expFinal3, `(${r.body.actualPayable})`);

  console.log('\n=== HAPPY PATH 5 (new, 2026-09-08): a genuine no-op is ALLOWED, not rejected ===');
  // Resubmitting the EXACT current state — discount 10%, no GST — with no note at all, using a
  // reason (GST_PERCENT_CORRECTED) that would be a lie if actually stored: nothing about GST is
  // being corrected, since GST isn't even applicable. The server must override this to
  // RECONFIRMED_NO_CHANGE rather than trust the submitted reason.
  r = await api(`/api/orders/${orderId}/billing-correction`, {
    method: 'PATCH', token: ownerToken,
    body: { discountApplicable: true, discountPercent: 10, gstApplicable: false, reason: 'GST_PERCENT_CORRECTED', pin: OWNER_PIN },
  });
  check('200 on a genuine no-op (allowed, not rejected)', r.status === 200, JSON.stringify(r.body).slice(0, 160));
  check('no-op: actualPayable unchanged', Number(r.body.actualPayable) === expFinal3, `(${r.body.actualPayable})`);

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const noOpRow = await prisma.orderBillingCorrection.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  check('no-op: stored reason overridden to RECONFIRMED_NO_CHANGE (not the submitted GST_PERCENT_CORRECTED)',
    noOpRow.reason === 'RECONFIRMED_NO_CHANGE', `(stored: ${noOpRow.reason})`);
  check('no-op: note not required and correctly null (none was sent)', noOpRow.note === null, `(${noOpRow.note})`);
  check('no-op: old* equals new* on every column',
    String(noOpRow.oldDiscountApplicable) === String(noOpRow.newDiscountApplicable) &&
    String(noOpRow.oldDiscountPercent) === String(noOpRow.newDiscountPercent) &&
    String(noOpRow.oldGstApplicable) === String(noOpRow.newGstApplicable) &&
    String(noOpRow.oldGstPercent) === String(noOpRow.newGstPercent) &&
    String(noOpRow.oldActualPayable) === String(noOpRow.newActualPayable),
    JSON.stringify(noOpRow));
  await prisma.$disconnect();

  console.log('\n=== RULE 103 PROPAGATION: listOrders totalValue must follow actualPayable ===');
  r = await api(`/api/orders?partyId=${created.partyId}`, { token: ownerToken });
  const listed = r.body.find((o) => o.id === orderId);
  check('list totalValue === corrected actualPayable', Number(listed.totalValue) === expFinal3, `(${listed?.totalValue} vs ${expFinal3})`);

  console.log('\n=== HISTORY (rule 104 + the no-op label fix) ===');
  r = await api('/api/history', { token: ownerToken });
  const ownerEntries = r.body.filter((e) => e.type === 'BILLING_CORRECTION');
  check('OWNER sees BILLING_CORRECTION entries', ownerEntries.length >= 5, `(saw ${ownerEntries.length})`);

  const noOpEntry = ownerEntries.find((e) => e.description.startsWith('Billing re-confirmed'));
  check('a distinct "Billing re-confirmed — no change" entry exists', !!noOpEntry, JSON.stringify(ownerEntries.map((e) => e.description)));
  if (noOpEntry) console.log('  no-op entry:', noOpEntry.description);
  check('no-op entry never uses "corrected" phrasing', !!noOpEntry && !/Billing corrected/.test(noOpEntry.description), noOpEntry?.description);
  check('no-op entry mentions the real current amount', !!noOpEntry && noOpEntry.description.includes(inrForTest(expFinal3)), noOpEntry?.description);

  r = await api('/api/history', { token: staffToken });
  const staffSees = r.body.filter((e) => e.type === 'BILLING_CORRECTION');
  check('STAFF sees ZERO billing corrections (rule 104)', staffSees.length === 0, `(saw ${staffSees.length})`);
  const staffLeak = JSON.stringify(r.body).includes('Billing corrected') || JSON.stringify(r.body).includes('Billing re-confirmed');
  check('no billing-correction string anywhere in STAFF feed', !staffLeak);

  await cleanup();

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log('FAILED:', failures.join(', '));
  }
  process.exit(fail === 0 ? 0 : 1);
}

// Matches dashboard/Parties.jsx's own inr() exactly (₹ prefix, Math.round, en-IN grouping) — used
// only to build the substring this file checks for inside a rendered History description.
function inrForTest(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`;
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
