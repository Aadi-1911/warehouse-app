// At-billing price overrides (05_BUSINESS_RULES.md rule 113) — the parsing and comparison half.
//
// Purely functional: no Prisma, no Express, no database. Same shape as utils/billNo.js and
// utils/piecesPerSet.js, and for the same reason — every rule in here is a statement about the
// SHAPE of what a client sent, decidable without touching an order, so it is testable standalone
// and cannot accidentally grow a query. The parts that need real order data (which articles are
// actually on this bill, what the baseline resolved to, whether a PIN is therefore required) live
// in billOrder, because those are questions about an order rather than about a request body.
//
// === WHY THE PARSERS ARE STRICT RATHER THAN FORGIVING ===
// Every function here returns { ok: false, message } for anything it does not fully recognise,
// and billOrder turns that into a 400. It never silently drops an entry it could not read.
//
// That is deliberate and it is the whole security argument of rule 113. routes/products.js's
// requirePinForPriceEdits decides whether to demand a PIN by looking for known keys in a body:
//
//     const editingPrice = 'costPrice' in req.body || 'sellingPrice' in req.body;
//
// which is safe only for as long as nobody invents a body shape it doesn't recognise — at which
// point a real price edit reaches a handler that still writes the price, with no PIN and nothing
// visibly wrong. That route's own comment (routes/products.js:60-67) calls this out and refuses to
// let a price-writing route use the pattern.
//
// Rule 113's gate is not vulnerable to that, for a structural reason worth stating plainly: the
// PIN decision is not made from the body at all. It is made by comparing two arrays of prices the
// SERVER computed — the baseline from utils/locationPricing.js, and the final prices after
// applying whatever this file managed to parse. An override this file cannot read never enters the
// final array, so it cannot change a price, so there is nothing for it to bypass. Unparseable
// input fails closed twice over: rejected with a 400 here, and incapable of moving money even if
// the 400 were somehow removed.

// Rupees, two decimal places. Not a display convention — a validation boundary: anything finer is
// rejected outright rather than rounded, because silently rewriting an owner's money figure is
// exactly the class of quiet mutation this codebase avoids everywhere else (see
// Order.roundingAdjustment, which exists so that even the ONE rounding the system does perform is
// stored as a fact rather than absorbed).
const MAX_PRICE_DECIMALS = 2;

// Shared by both parsers below. Returns a message on failure and null on success, so a caller can
// prefix it with whichever field it was validating.
function validatePriceValue(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label} must be a finite number`;
  }
  // > 0, never >= 0. Rule 113 blocks a zero or negative price outright (an override is what a
  // party is charged; zero is not a price, it is a giveaway with no record of why). This matches
  // productController's setLocationPrice rejection exactly, which chose the same boundary for the
  // same reason.
  if (value <= 0) {
    return `${label} must be greater than 0`;
  }
  // Counts decimals on the DECIMAL STRING, not by multiplying and comparing to an integer.
  // `Math.round(v * 100) === v * 100` looks equivalent and is not: 4.35 * 100 is 434.99999999999994
  // in float64, so that test rejects a perfectly valid two-decimal rupee figure. Reading the digits
  // the number actually prints as sidesteps binary representation entirely.
  const text = String(value);
  const dot = text.indexOf('.');
  if (dot !== -1 && text.length - dot - 1 > MAX_PRICE_DECIMALS) {
    return `${label} must have at most ${MAX_PRICE_DECIMALS} decimal places`;
  }
  // Exponential notation ("1e-7") has no '.' and would slip past the check above. Nothing a real
  // client sends looks like this, which is exactly why it is worth rejecting explicitly rather
  // than hoping.
  if (text.includes('e') || text.includes('E')) {
    return `${label} must be a plain decimal number, not exponential notation`;
  }
  return null;
}

// req.body.priceOverrides -> Map<productId, number>.
//
// ABSENT and EMPTY ARRAY are both legitimate and mean the same thing — "no price changed" — which
// is the overwhelmingly common case (every bill before rule 113 existed, and almost every bill
// after it). Neither requires a PIN, because neither changes a price. Contrast seenPrices below,
// which is required.
function parsePriceOverrides(raw) {
  if (raw === undefined || raw === null) return { ok: true, overrides: new Map() };
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'priceOverrides must be an array of { productId, unitPrice } objects' };
  }

  const overrides = new Map();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, message: `priceOverrides[${i}] must be an object with productId and unitPrice` };
    }
    const { productId, unitPrice } = entry;
    if (typeof productId !== 'string' || productId.trim() === '') {
      return { ok: false, message: `priceOverrides[${i}].productId must be a non-empty string` };
    }
    const priceError = validatePriceValue(unitPrice, `priceOverrides[${i}].unitPrice`);
    if (priceError) return { ok: false, message: priceError };

    // DUPLICATES ARE AN ERROR, never last-wins. Two entries for one article is ambiguous intent,
    // and last-wins resolves that ambiguity by silently discarding one of the two numbers the
    // owner typed — a money figure vanishing with no error is precisely the failure this endpoint
    // must not have. Naming the article in the message so the client can point at the real row.
    if (overrides.has(productId)) {
      return { ok: false, message: `priceOverrides contains more than one entry for productId ${productId} — send exactly one price per article` };
    }
    overrides.set(productId, unitPrice);
  }

  return { ok: true, overrides };
}

// req.body.seenPrices -> Map<lineItemId, number>.
//
// REQUIRED on every bill, unlike priceOverrides above — an absent value is a 400, not an empty
// map. This is the stale-price guard (rule 113): the client echoes back the exact per-line prices
// the fulfillment preview showed the owner, and billOrder refuses to bill if any of them has since
// moved. A caller that doesn't send it hasn't shown the owner anything to approve, so there is
// nothing to check against and the guard would be silently absent.
//
// Same "loud break" reasoning billOrder already applies to locationId: an older client that
// doesn't send this gets a clear 400 rather than a bill that skips the check. See
// 06_ROADMAP.md's DEPLOY CONSTRAINT — this backend must not ship without the frontend that sends
// it.
function parseSeenPrices(raw) {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      message: 'seenPrices is required — echo back the per-line prices from GET /api/orders/:id/fulfillment-preview so the server can confirm nothing changed while you were reviewing',
    };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'seenPrices must be an array of { lineItemId, unitPrice } objects' };
  }

  const seen = new Map();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, message: `seenPrices[${i}] must be an object with lineItemId and unitPrice` };
    }
    const { lineItemId, unitPrice } = entry;
    if (typeof lineItemId !== 'string' || lineItemId.trim() === '') {
      return { ok: false, message: `seenPrices[${i}].lineItemId must be a non-empty string` };
    }
    // Deliberately the SAME validatePriceValue the overrides get, including the > 0 rule. A
    // preview never emits a zero or negative price, so an echo containing one is a corrupted or
    // hand-made body, and treating it as a legitimate "seen" value would let it silently satisfy
    // the staleness comparison.
    const priceError = validatePriceValue(unitPrice, `seenPrices[${i}].unitPrice`);
    if (priceError) return { ok: false, message: priceError };

    if (seen.has(lineItemId)) {
      return { ok: false, message: `seenPrices contains more than one entry for lineItemId ${lineItemId}` };
    }
    seen.set(lineItemId, unitPrice);
  }

  return { ok: true, seen };
}

// Money equality across the two representations this feature has to compare: a Prisma Decimal
// (what a baseline resolves to — priceAtOrder and LocationPrice.sellingPrice are both
// DECIMAL(65,30)) and a plain JS number (what a client sends).
//
// Number() on both sides rather than Decimal arithmetic, and the reason it is safe here rather
// than merely convenient: both sides are rupee figures with at most two decimal places —
// validatePriceValue above enforces that on every client-supplied number, and every price the
// system itself writes came through the same door. Converting a two-decimal decimal string and the
// identical two-decimal JS literal to float64 yields the SAME double in both cases (each rounds to
// the single nearest representable value), so === is exact for every value this function will
// actually see.
//
// The limitation, stated rather than buried: this would be wrong for a value with more than ~15
// significant digits, where two different decimals can round to one double. No money column in
// this schema can reach that — DECIMAL(65,30) permits it, rule 113 and setLocationPrice do not —
// but a future feature that stores a genuinely high-precision figure here must revisit this rather
// than assume it still holds.
function priceEquals(a, b) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

module.exports = { parsePriceOverrides, parseSeenPrices, priceEquals, validatePriceValue, MAX_PRICE_DECIMALS };
