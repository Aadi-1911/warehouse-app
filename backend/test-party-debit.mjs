// Real, persisted test for rule 106 — POST /api/party-debits, its fold into
// GET /api/parties/:id/payable's amountDue, and its GET /api/history rendering. Same file
// convention as test-order-billing-correction.mjs (flat .mjs under backend/, matching this
// project's own "real test file" naming pattern) and the same FK-safe self-cleaning discipline.
//
// RUN AGAINST THE TEST BRANCH ONLY, NEVER DEV. Start the backend first with the project's own
// documented convention (backend/package.json's `start:test` script):
//   npm run start:test
// then in a second terminal:
//   node test-party-debit.mjs
// `start:test` sets NODE_ENV=test, which server.js reads to force DATABASE_URL to
// TEST_DATABASE_URL and refuses to start if that variable is unset.
//
// This file also makes its OWN direct Prisma queries (none needed here beyond cleanup, but the
// guard is applied unconditionally regardless) — the exact dev/TEST mixup discovered and fixed
// earlier this session. Overriding DATABASE_URL in THIS process before any @prisma/client import,
// with the identical refuse-to-fall-back guard, applies even to a file that turns out not to need
// a direct query, since the alternative is trusting every future edit to this file to remember why.
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

// Fails LOUDLY on a bad login — the fix this session applied to the previous test file's own
// silent-skip bug, carried forward here from the start rather than reintroduced.
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

const created = { partyId: null, otherPartyId: null, staffUserId: null };

async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    for (const partyId of [created.partyId, created.otherPartyId]) {
      if (!partyId) continue;
      await prisma.partyDebit.deleteMany({ where: { partyId } });
      await prisma.partyPayment.deleteMany({ where: { partyId } });
      await prisma.party.delete({ where: { id: partyId } }).catch(() => {});
    }
    console.log('  deleted party debits/payments/parties');
    // LAST, deliberately, and only after every row above is gone: PartyDebit.recordedById and
    // PartyPayment.recordedById both point AT User, so deleting the account first would fail the
    // FK rather than cascade. (This file's staff account never records either — it exists only to
    // prove STAFF is rejected — but the ordering can't depend on that staying true.)
    //
    // A HARD delete of a User is normally forbidden (rule 75 — accounts are deactivated, never
    // deleted, so historical rows stay resolvable forever). The one narrow exception is an account
    // whose username starts with "probe": those are test artifacts that never belonged to a real
    // person, which is exactly why this account is named `probe_pd_staff_${stamp}`. Renaming it
    // would quietly move it outside that exception and make this line a rule violation.
    if (created.staffUserId) await prisma.user.delete({ where: { id: created.staffUserId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const ownerToken = await login('owner', 'owner1234');

  console.log('\n=== SETUP: a fresh party with no orders/payments/returns ===');
  const stamp = Date.now();

  // This file used to log straight in as a hand-made account, `probe_billno_staff`, that nothing
  // in the repo ever created — it happened to exist on the long-lived dev/TEST database because
  // someone made it interactively months ago. A `prisma migrate reset` destroys it (the seed
  // creates only "owner"), and this file then died at its very first line with
  // `FATAL: Login failed for "probe_billno_staff"` before a single assertion ran. Creating the
  // account here instead makes the file self-sufficient on a freshly reset database, which is the
  // only state a test file may assume.
  //
  // Pattern copied from test-location-pricing.mjs (its staff-user block), including the
  // `${stamp}` suffix: a crashed run leaves its user behind, and a fixed username would then
  // collide with User.username's unique constraint on the very next run — turning one failure
  // into a permanently wedged test.
  //
  // The "probe" prefix is required, not cosmetic: it is what puts this account inside rule 75's
  // one exception and makes cleanup()'s hard delete legitimate.
  const staffUsername = `probe_pd_staff_${stamp}`;
  const staffPassword = 'ProbeStaff!2026';
  let r = await api('/api/users', {
    method: 'POST',
    token: ownerToken,
    body: { username: staffUsername, password: staffPassword, name: 'PD Probe Staff', role: 'STAFF' },
  });
  if (!r.body?.id) throw new Error(`Staff user creation failed: ${JSON.stringify(r.body)}`);
  created.staffUserId = r.body.id;
  const staffToken = await login(staffUsername, staffPassword);

  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `PDParty-${stamp}` } });
  created.partyId = r.body.id;
  console.log('  party:', created.partyId, r.status);

  r = await api(`/api/parties/${created.partyId}/payable`, { token: ownerToken });
  check('fresh party: amountDue starts at 0', Number(r.body.amountDue) === 0, JSON.stringify(r.body));
  check('fresh party: totalDebited starts at 0', Number(r.body.totalDebited) === 0, JSON.stringify(r.body));
  check('fresh party: debits array starts empty', Array.isArray(r.body.debits) && r.body.debits.length === 0);

  console.log('\n=== REJECTION PATHS ===');

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 5000, date: '2026-01-01' },
  });
  check('403 without PIN', r.status === 403 && r.body.error?.code === 'MISSING_PIN', JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 5000, date: '2026-01-01', pin: '999999' },
  });
  check('403 with wrong PIN', r.status === 403 && r.body.error?.code === 'INVALID_PIN', JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: staffToken,
    body: { partyId: created.partyId, amount: 5000, date: '2026-01-01', pin: OWNER_PIN },
  });
  check('403 for STAFF role', r.status === 403, JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { amount: 5000, date: '2026-01-01', pin: OWNER_PIN },
  });
  check('400 missing partyId', r.status === 400, JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: -5, date: '2026-01-01', pin: OWNER_PIN },
  });
  check('400 negative amount', r.status === 400, JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 5000, date: 'not-a-date', pin: OWNER_PIN },
  });
  check('400 invalid date', r.status === 400, JSON.stringify(r.body));

  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: 'clnonexistentpartyid00000000', amount: 5000, date: '2026-01-01', pin: OWNER_PIN },
  });
  check('404 party not found', r.status === 404 && r.body.error?.code === 'PARTY_NOT_FOUND', JSON.stringify(r.body));

  console.log('\n=== HAPPY PATH 1: record an opening-balance debit ===');
  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 5000, date: '2026-01-01', note: 'Opening balance as of 1 Jan 2026', pin: OWNER_PIN },
  });
  check('201 created', r.status === 201, JSON.stringify(r.body));
  check('response has correct shape', r.body.partyId === created.partyId && Number(r.body.amount) === 5000 && r.body.wasEdited === false, JSON.stringify(r.body));
  const firstDebitId = r.body.id;

  r = await api(`/api/parties/${created.partyId}/payable`, { token: ownerToken });
  check('payable: totalDebited reflects the debit', Number(r.body.totalDebited) === 5000, JSON.stringify(r.body));
  check('payable: amountDue = totalBilled(0) - paid(0) - returned(0) + debited(5000)', Number(r.body.amountDue) === 5000, JSON.stringify(r.body));
  check('payable: debits array contains the new row', r.body.debits.some((d) => d.id === firstDebitId));

  console.log('\n=== HAPPY PATH 2: a payment REDUCES amountDue on top of the debit ===');
  r = await api('/api/party-payments', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 2000, date: '2026-02-01', pin: OWNER_PIN },
  });
  check('payment recorded', r.status === 201, JSON.stringify(r.body));

  r = await api(`/api/parties/${created.partyId}/payable`, { token: ownerToken });
  check('amountDue = -2000(paid) + 5000(debited) = 3000', Number(r.body.amountDue) === 3000, JSON.stringify(r.body));
  check('totalDebited still 5000 (unaffected by the payment)', Number(r.body.totalDebited) === 5000, JSON.stringify(r.body));

  console.log('\n=== HAPPY PATH 3: debits STACK — a second debit on the same party is allowed ===');
  r = await api('/api/party-debits', {
    method: 'POST', token: ownerToken,
    body: { partyId: created.partyId, amount: 1500, date: '2026-03-01', pin: OWNER_PIN },
  });
  check('second debit on same party allowed (partyId not unique)', r.status === 201, JSON.stringify(r.body));

  r = await api(`/api/parties/${created.partyId}/payable`, { token: ownerToken });
  check('totalDebited now 6500', Number(r.body.totalDebited) === 6500, JSON.stringify(r.body));
  check('amountDue now -2000 + 6500 = 4500', Number(r.body.amountDue) === 4500, JSON.stringify(r.body));
  check('debits array has 2 rows', r.body.debits.length === 2, JSON.stringify(r.body.debits));

  console.log('\n=== ISOLATION: a debit on one party never touches another party\'s payable ===');
  r = await api('/api/parties', { method: 'POST', token: ownerToken, body: { name: `PDOther-${stamp}` } });
  created.otherPartyId = r.body.id;
  r = await api(`/api/parties/${created.otherPartyId}/payable`, { token: ownerToken });
  check("other party's amountDue unaffected, still 0", Number(r.body.amountDue) === 0, JSON.stringify(r.body));

  console.log('\n=== HISTORY (rule 104 + rule 106) ===');
  r = await api('/api/history', { token: ownerToken });
  const ownerEntries = r.body.filter((e) => e.type === 'PARTY_DEBIT' && e.partyName === `PDParty-${stamp}`);
  check('OWNER sees both PARTY_DEBIT entries for this party', ownerEntries.length === 2, `(saw ${ownerEntries.length})`);
  const noteEntry = ownerEntries.find((e) => e.description.includes('Opening balance as of 1 Jan 2026'));
  check('entry description includes the recorded note', !!noteEntry, JSON.stringify(ownerEntries.map((e) => e.description)));
  check('entry description states the amount', !!noteEntry && noteEntry.description.includes('₹5,000'), noteEntry?.description);
  check('entry actor is the OWNER who recorded it', ownerEntries.every((e) => e.actorRole === 'OWNER'));

  r = await api('/api/history', { token: staffToken });
  const staffSees = r.body.filter((e) => e.type === 'PARTY_DEBIT');
  check('STAFF sees ZERO party-debit entries (rule 104)', staffSees.length === 0, `(saw ${staffSees.length})`);
  const staffLeak = JSON.stringify(r.body).includes(`PDParty-${stamp}`);
  check('no trace of this test party anywhere in the STAFF feed', !staffLeak);

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
