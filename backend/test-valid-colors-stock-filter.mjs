// Real, persisted test for rule 107 as it applies to GET /api/products/:id/valid-colors — the
// one surface where rule 107's suppression is a query-level change rather than a client-side
// filter on top of an already-shared fetch (see LEARNING_LOG.md / the rule-107 investigation for
// why this endpoint, specifically, got the query change instead of GET /api/stock itself).
//
// WHAT THIS PROVES: before this change, getValidColors returned every Bundle wired to a Product
// regardless of whether it had any real stock — a colour that was misspelled, corrected via a
// brand-new Colour+Bundle pair (there is no rename endpoint — see colorController.js), and left
// with zero stock forever would still show up in New Order's colour picker next to the real one,
// with a "Low stock" badge (0 defaults into that badge, not a separate "out of stock" state).
// This is a confirmed real-world case, not hypothetical — found on Production article 6074
// ("Air-bule" vs "Air-blue"). The fix adds `stock: { some: { qtySets: { gt: 0 } } } }` to the
// Bundle where-clause. This file proves that filter actually excludes a zero-stock bundle and
// still includes a real one — a read-review of the where-clause alone can't prove Prisma's
// `some` filter behaves this way on both "no Stock row at all" and "a Stock row drained back to
// exactly zero," which are the two distinct ways a bundle ends up with no real stock.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-valid-colors-stock-filter.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file makes its own direct Prisma queries (seeding stock at an exact quantity is the whole
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

const created = {
  factoryId: null,
  categoryId: null,
  productId: null,
  colorIds: [],
  bundleIds: [],
  locationId: null,
};

let prisma = null;
async function db() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}

// Convergent cleanup by reference, same discipline as test-transfer-idempotency.mjs — running
// this twice, or after a crash, lands on the same clean state.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.bundleIds.length) {
      await p.transaction.deleteMany({ where: { stock: { bundleId: { in: created.bundleIds } } } });
      await p.stock.deleteMany({ where: { bundleId: { in: created.bundleIds } } });
      for (const bundleId of created.bundleIds) {
        await p.bundle.delete({ where: { id: bundleId } }).catch(() => {});
      }
    }
    if (created.productId) {
      await p.productSize.deleteMany({ where: { productId: created.productId } });
      await p.product.delete({ where: { id: created.productId } }).catch(() => {});
    }
    for (const colorId of created.colorIds) {
      await p.color.delete({ where: { id: colorId } }).catch(() => {});
    }
    if (created.factoryId) await p.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    if (created.locationId) await p.location.delete({ where: { id: created.locationId } }).catch(() => {});
    console.log('  deleted transactions/stock/bundles/product/colors/factory/location');
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();

  console.log('\n=== SETUP: isolated factory / location / article / 3 colours / 3 bundles ===');

  let r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `ValidColorsFactory-${stamp}` } });
  if (!r.body?.id) throw new Error(`Factory creation failed: ${JSON.stringify(r.body)}`);
  created.factoryId = r.body.id;

  r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `ValidColorsLoc-${stamp}` } });
  if (!r.body?.id) throw new Error(`Location creation failed: ${JSON.stringify(r.body)}`);
  created.locationId = r.body.id;

  const categories = await api('/api/categories', { token: ownerToken });
  created.categoryId = categories.body[0]?.id;
  if (!created.categoryId) throw new Error('No Category exists on the test branch — cannot create a Product.');

  r = await api('/api/products', {
    method: 'POST',
    token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `VCF-${stamp}`,
      name: `Valid Colors Test Article ${stamp}`,
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
      costPrice: 100,
      sellingPrice: 200,
      pin: OWNER_PIN,
    },
  });
  if (!r.body?.id) throw new Error(`Product creation failed: ${JSON.stringify(r.body)}`);
  created.productId = r.body.id;

  // Three colours, three bundles on the same product — each exercising a distinct way a bundle
  // can end up with (or without) real stock:
  //   NeverStocked — a Bundle that has never received a Transaction, so no Stock row exists at all.
  //   DrainedToZero — a Bundle that WAS stocked, then fully moved out, leaving a real Stock row
  //                   sitting at qtySets = 0 (this is the exact shape "Air-bule" was found in —
  //                   a Bundle can also simply never be drained and just start at 0; either way
  //                   the resulting row is the same).
  //   RealStock — a Bundle genuinely holding stock right now. The control case: this MUST still
  //               come back, or the filter would be over-broad and break New Order entirely.
  async function makeColorAndBundle(label) {
    const c = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `${label}-${stamp}` } });
    if (!c.body?.id) throw new Error(`Color creation failed for ${label}: ${JSON.stringify(c.body)}`);
    created.colorIds.push(c.body.id);
    const b = await api('/api/bundles', { method: 'POST', token: ownerToken, body: { productId: created.productId, colorId: c.body.id } });
    if (!b.body?.id) throw new Error(`Bundle creation failed for ${label}: ${JSON.stringify(b.body)}`);
    created.bundleIds.push(b.body.id);
    return { colorId: c.body.id, colorName: c.body.name, bundleId: b.body.id };
  }

  const neverStocked = await makeColorAndBundle('NeverStocked');
  const drainedToZero = await makeColorAndBundle('DrainedToZero');
  const realStock = await makeColorAndBundle('RealStock');

  // DrainedToZero: stock in 3, then stock out the same 3 — real Stock row, real Transaction
  // history, ends at exactly qtySets = 0.
  let tx = await api('/api/transactions', { method: 'POST', token: ownerToken, body: { bundleId: drainedToZero.bundleId, locationId: created.locationId, type: 'STOCK_IN', qtySets: 3 } });
  if (tx.status !== 201) throw new Error(`DrainedToZero stock-in failed: ${JSON.stringify(tx.body)}`);
  tx = await api('/api/transactions', { method: 'POST', token: ownerToken, body: { bundleId: drainedToZero.bundleId, locationId: created.locationId, type: 'STOCK_OUT', qtySets: 3 } });
  if (tx.status !== 201) throw new Error(`DrainedToZero stock-out failed: ${JSON.stringify(tx.body)}`);

  // RealStock: stock in 5, left alone.
  tx = await api('/api/transactions', { method: 'POST', token: ownerToken, body: { bundleId: realStock.bundleId, locationId: created.locationId, type: 'STOCK_IN', qtySets: 5 } });
  if (tx.status !== 201) throw new Error(`RealStock stock-in failed: ${JSON.stringify(tx.body)}`);

  // Ground-truth check on the DB directly, independent of the endpoint under test — confirms the
  // setup itself is correct before trusting what getValidColors says about it.
  const p = await db();
  const drainedStockRow = await p.stock.findFirst({ where: { bundleId: drainedToZero.bundleId } });
  check('DrainedToZero has a real Stock row at qtySets = 0 (ground truth)', drainedStockRow?.qtySets === 0, `got ${JSON.stringify(drainedStockRow)}`);
  const neverStockedRow = await p.stock.findFirst({ where: { bundleId: neverStocked.bundleId } });
  check('NeverStocked has no Stock row at all (ground truth)', neverStockedRow === null, `got ${JSON.stringify(neverStockedRow)}`);
  const realStockRow = await p.stock.findFirst({ where: { bundleId: realStock.bundleId } });
  check('RealStock has a real Stock row at qtySets = 5 (ground truth)', realStockRow?.qtySets === 5, `got ${JSON.stringify(realStockRow)}`);

  console.log('\n=== GET /api/products/:id/valid-colors ===');
  const res = await api(`/api/products/${created.productId}/valid-colors`, { token: ownerToken });
  check('valid-colors returns 200', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)}`);

  const returnedColorIds = new Set((res.body ?? []).map((c) => c.id));
  console.log('  returned colours:', JSON.stringify(res.body));

  check(
    'NeverStocked (no Stock row at all) is excluded',
    !returnedColorIds.has(neverStocked.colorId)
  );
  check(
    'DrainedToZero (real Stock row at qtySets = 0) is excluded',
    !returnedColorIds.has(drainedToZero.colorId)
  );
  check(
    'RealStock (qtySets = 5) is still included',
    returnedColorIds.has(realStock.colorId)
  );

  // Response shape is unchanged by this fix — only the filtering changed, so whatever DOES come
  // back must still carry exactly {id, name, bundleId}, nothing added or dropped.
  const realStockEntry = (res.body ?? []).find((c) => c.id === realStock.colorId);
  check(
    'the surviving entry keeps the exact {id, name, bundleId} shape',
    !!realStockEntry && realStockEntry.name === realStock.colorName && realStockEntry.bundleId === realStock.bundleId,
    `got ${JSON.stringify(realStockEntry)}`
  );

  check('exactly one colour came back (RealStock only)', (res.body ?? []).length === 1, `got ${JSON.stringify(res.body)}`);
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
