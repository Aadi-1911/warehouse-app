// Real, persisted test for rule 107 — Transfer Stock idempotency. Same file convention as
// test-party-debit.mjs and test-order-billing-correction.mjs (flat .mjs under backend/), and the
// same FK-safe self-cleaning discipline.
//
// WHAT THIS PROVES, and why it's worth a dedicated file: POST /api/transfers had no protection
// against a line being applied twice when its original response was lost after a successful
// commit. The frontend loops per line and re-submits anything it recorded as failed, so a lost
// response produced a retry the server could not distinguish from a genuine second transfer.
// The core assertion below is that the same idempotencyKey submitted twice yields exactly ONE
// Transfer row and exactly ONE stock movement — not two.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-transfer-idempotency.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file makes its own direct Prisma queries (counting Transfer/Transaction rows is the whole
// point), so it applies the same refuse-to-fall-back guard before any @prisma/client import.
const dotenv = await import('dotenv');
dotenv.config({ quiet: true });
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set — refusing to run this file\'s direct Prisma queries against DATABASE_URL and risk touching the real dev database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const BASE = 'http://localhost:3002';

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
  colorId: null,
  bundleId: null,
  fromLocationId: null,
  toLocationId: null,
};

let prisma = null;
async function db() {
  if (!prisma) {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }
  return prisma;
}

// Locates targets by REFERENCE (bundleId/product id), never by ids merely held in memory from a
// run that may have crashed — the convergent-cleanup discipline this project already learned the
// hard way three times (see LEARNING_LOG.md). Running this twice, or after a crash, lands on the
// same clean state.
async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const p = await db();
  try {
    if (created.bundleId) {
      await p.transaction.deleteMany({ where: { stock: { bundleId: created.bundleId } } });
      await p.transfer.deleteMany({ where: { bundleId: created.bundleId } });
      await p.stock.deleteMany({ where: { bundleId: created.bundleId } });
      await p.bundle.delete({ where: { id: created.bundleId } }).catch(() => {});
    }
    if (created.productId) {
      await p.productSize.deleteMany({ where: { productId: created.productId } });
      await p.product.delete({ where: { id: created.productId } }).catch(() => {});
    }
    if (created.colorId) await p.color.delete({ where: { id: created.colorId } }).catch(() => {});
    if (created.factoryId) await p.factory.delete({ where: { id: created.factoryId } }).catch(() => {});
    for (const locId of [created.fromLocationId, created.toLocationId]) {
      if (locId) await p.location.delete({ where: { id: locId } }).catch(() => {});
    }
    console.log('  deleted transactions/transfers/stock/bundle/product/color/factory/locations');
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');
  const stamp = Date.now();
  const p = await db();

  console.log('\n=== SETUP: isolated factory / locations / article / colour / bundle / stock ===');

  let r = await api('/api/factories', { method: 'POST', token: ownerToken, body: { name: `IdemFactory-${stamp}` } });
  created.factoryId = r.body.id;

  r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `IdemFrom-${stamp}` } });
  created.fromLocationId = r.body.id;
  r = await api('/api/locations', { method: 'POST', token: ownerToken, body: { name: `IdemTo-${stamp}` } });
  created.toLocationId = r.body.id;

  const categories = await api('/api/categories', { token: ownerToken });
  created.categoryId = categories.body[0]?.id;
  if (!created.categoryId) throw new Error('No Category exists on the test branch — cannot create a Product.');

  r = await api('/api/products', {
    method: 'POST', token: ownerToken,
    body: {
      factoryId: created.factoryId,
      articleNo: `IDEM-${stamp}`,
      name: `Idempotency Probe ${stamp}`,
      categoryId: created.categoryId,
      isKids: false,
      sizes: [{ sizeLabel: 'M', sortOrder: 0, qty: 1 }],
    },
  });
  created.productId = r.body.id;
  if (!created.productId) throw new Error(`Product creation failed: ${JSON.stringify(r.body)}`);

  r = await api('/api/colors', { method: 'POST', token: ownerToken, body: { name: `IdemColor-${stamp}` } });
  created.colorId = r.body.id;

  r = await api('/api/bundles', {
    method: 'POST', token: ownerToken,
    body: { productId: created.productId, colorId: created.colorId },
  });
  created.bundleId = r.body.id;
  if (!created.bundleId) throw new Error(`Bundle creation failed: ${JSON.stringify(r.body)}`);

  // Seed 10 sets at the source via the real STOCK_IN path — never a direct Stock write, per
  // CLAUDE.md's standing rule that Stock.qtySets only ever changes via a Transaction.
  r = await api('/api/transactions', {
    method: 'POST', token: ownerToken,
    body: { bundleId: created.bundleId, locationId: created.fromLocationId, type: 'STOCK_IN', qtySets: 10 },
  });
  check('setup: seeded 10 sets at source', r.status === 201, JSON.stringify(r.body));

  const KEY = `test-idem-${stamp}`;

  console.log('\n=== VALIDATION: idempotencyKey shape is checked ===');
  r = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 1, idempotencyKey: '',
    },
  });
  check('400 on empty-string key', r.status === 400, JSON.stringify(r.body));

  r = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 1, idempotencyKey: 'x'.repeat(201),
    },
  });
  check('400 on over-length key', r.status === 400, JSON.stringify(r.body));

  console.log('\n=== THE CORE CASE: same key submitted twice ===');

  const first = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 3, idempotencyKey: KEY,
    },
  });
  check('first call: 201 created', first.status === 201, JSON.stringify(first.body));
  check('first call: idempotentReplay is false', first.body?.idempotentReplay === false, JSON.stringify(first.body));
  check('first call: source now 7', first.body?.fromStock?.qtySets === 7, JSON.stringify(first.body?.fromStock));
  check('first call: destination now 3', first.body?.toStock?.qtySets === 3, JSON.stringify(first.body?.toStock));

  // The retry. Byte-identical body, exactly as Transfer.jsx re-submits a line it recorded as
  // failed — which is the real-world path this whole mechanism exists for.
  const second = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 3, idempotencyKey: KEY,
    },
  });
  check('retry: 200, not 201 (nothing created)', second.status === 200, `got ${second.status}`);
  check('retry: idempotentReplay is true', second.body?.idempotentReplay === true, JSON.stringify(second.body));
  check(
    'retry: returns the SAME transfer id as the original',
    second.body?.transfer?.id === first.body?.transfer?.id,
    `first=${first.body?.transfer?.id} second=${second.body?.transfer?.id}`
  );
  check('retry: source still 7, NOT 4', second.body?.fromStock?.qtySets === 7, JSON.stringify(second.body?.fromStock));
  check('retry: destination still 3, NOT 6', second.body?.toStock?.qtySets === 3, JSON.stringify(second.body?.toStock));

  console.log('\n=== GROUND TRUTH: straight from the database, not the API response ===');

  const transferRows = await p.transfer.findMany({ where: { idempotencyKey: KEY } });
  check('exactly ONE Transfer row carries this key', transferRows.length === 1, `(found ${transferRows.length})`);

  const allTransfers = await p.transfer.findMany({ where: { bundleId: created.bundleId } });
  check('exactly ONE Transfer row for this bundle in total', allTransfers.length === 1, `(found ${allTransfers.length})`);

  const legs = await p.transaction.findMany({
    where: { transferId: { in: allTransfers.map((t) => t.id) } },
  });
  const outs = legs.filter((l) => l.type === 'TRANSFER_OUT');
  const ins = legs.filter((l) => l.type === 'TRANSFER_IN');
  check('exactly TWO transaction legs exist, not four', legs.length === 2, `(found ${legs.length})`);
  check('exactly one TRANSFER_OUT', outs.length === 1, `(found ${outs.length})`);
  check('exactly one TRANSFER_IN', ins.length === 1, `(found ${ins.length})`);

  const fromStockRow = await p.stock.findUnique({
    where: { bundleId_locationId: { bundleId: created.bundleId, locationId: created.fromLocationId } },
  });
  const toStockRow = await p.stock.findUnique({
    where: { bundleId_locationId: { bundleId: created.bundleId, locationId: created.toLocationId } },
  });
  check('DB: source Stock.qtySets is 7 (10 - 3, applied once)', fromStockRow?.qtySets === 7, `(got ${fromStockRow?.qtySets})`);
  check('DB: destination Stock.qtySets is 3 (applied once)', toStockRow?.qtySets === 3, `(got ${toStockRow?.qtySets})`);
  check('DB: total across both locations still 10 — nothing created or destroyed',
    (fromStockRow?.qtySets ?? 0) + (toStockRow?.qtySets ?? 0) === 10,
    `(got ${(fromStockRow?.qtySets ?? 0) + (toStockRow?.qtySets ?? 0)})`);

  console.log('\n=== CONCURRENCY: two identical requests fired simultaneously ===');
  // The case the pre-flight lookup structurally cannot catch on its own — both requests can read
  // "no such key" before either has inserted. Only the unique index makes this safe, so it is
  // worth proving rather than reasoning about.
  const RACE_KEY = `test-idem-race-${stamp}`;
  const raceBody = {
    bundleId: created.bundleId, fromLocationId: created.fromLocationId,
    toLocationId: created.toLocationId, qtySets: 2, idempotencyKey: RACE_KEY,
  };
  const [a, b] = await Promise.all([
    api('/api/transfers', { method: 'POST', token: ownerToken, body: raceBody }),
    api('/api/transfers', { method: 'POST', token: ownerToken, body: raceBody }),
  ]);
  check('both concurrent calls succeeded (no 500, no 409)',
    [200, 201].includes(a.status) && [200, 201].includes(b.status), `a=${a.status} b=${b.status}`);
  check('exactly one of the two reports a fresh create',
    [a.body?.idempotentReplay, b.body?.idempotentReplay].filter((v) => v === false).length === 1,
    `a=${a.body?.idempotentReplay} b=${b.body?.idempotentReplay}`);

  const raceRows = await p.transfer.findMany({ where: { idempotencyKey: RACE_KEY } });
  check('exactly ONE Transfer row from the concurrent pair', raceRows.length === 1, `(found ${raceRows.length})`);

  const fromAfterRace = await p.stock.findUnique({
    where: { bundleId_locationId: { bundleId: created.bundleId, locationId: created.fromLocationId } },
  });
  check('DB: source is 5 (7 - 2, applied once despite two calls)', fromAfterRace?.qtySets === 5, `(got ${fromAfterRace?.qtySets})`);

  console.log('\n=== REGRESSION: a request with NO key still works (pre-deploy clients) ===');
  r = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 1,
    },
  });
  check('keyless transfer still returns 201', r.status === 201, JSON.stringify(r.body));
  check('keyless transfer reports idempotentReplay false', r.body?.idempotentReplay === false, JSON.stringify(r.body));

  const keyless = await p.transfer.findMany({ where: { bundleId: created.bundleId, idempotencyKey: null } });
  check('keyless row stored with idempotencyKey = NULL', keyless.length === 1, `(found ${keyless.length})`);

  // Two NULL keys must be able to coexist under the UNIQUE index — the property that lets the 47
  // pre-existing Production rows survive this migration untouched.
  r = await api('/api/transfers', {
    method: 'POST', token: ownerToken,
    body: {
      bundleId: created.bundleId, fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId, qtySets: 1,
    },
  });
  check('a SECOND keyless transfer also succeeds (NULLs do not collide under UNIQUE)',
    r.status === 201, JSON.stringify(r.body));

  const keylessAfter = await p.transfer.findMany({ where: { bundleId: created.bundleId, idempotencyKey: null } });
  check('two NULL-key rows coexist', keylessAfter.length === 2, `(found ${keylessAfter.length})`);

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
