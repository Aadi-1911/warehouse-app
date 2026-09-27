import { piecesPerSetFor } from './piecesPerSet';

// At-billing price overrides (05_BUSINESS_RULES.md rule 113) — the CLIENT half, shared by both
// billing entry points (BillOrderDetail.jsx mobile, dashboard/Orders.jsx's "Mark billed" modal).
//
// Same reason utils/orderBilling.js is shared between those two screens: they are two separately
// rendered confirm flows for the ONE irreversible action in the order lifecycle, and if each did
// its own grouping/validation/arithmetic they could show the same order two different prices. Every
// derivation below happens exactly once, here.
//
// NOTHING HERE IS AUTHORITATIVE. The server recomputes the baseline, re-decides whether a PIN was
// required, and recomputes preTaxAmount from its own array (orderController.js's `finalLines`).
// This file exists to show the owner what they are about to do and to build the request body — it
// is a display-and-input layer, deliberately unable to decide anything the server will act on.

// Mirrors backend/src/utils/billPriceOverrides.js's MAX_PRICE_DECIMALS. Duplicated rather than
// imported for the same reason utils/piecesPerSet.js is duplicated — frontend and backend are
// separate codebases with no shared-constants package — so if this boundary ever moves, both
// copies move together.
export const MAX_PRICE_DECIMALS = 2;

// The three PIN failures PATCH /api/orders/:id/bill can answer with (04_API_SPEC.md:540). Shared by
// both screens because both need the same branch: PinPrompt already renders these itself — the
// message, and INVALID_PIN's "(N attempts remaining)" from the response's sibling field — so a
// screen must NOT also raise its own banner for them, or the owner reads the same failure twice in
// two different places. Every other error code is the screen's own to display.
export const PIN_ERROR_CODES = new Set(['MISSING_PIN', 'INVALID_PIN', 'PIN_LOCKED']);

// Validates ONE typed price string against exactly the rules the server enforces (> 0, at most two
// decimals, no exponential notation). Returns an error message, or null when the value is fine.
//
// Deliberately validates `String(Number(raw))` — the number this client will actually SEND — rather
// than the raw keystrokes. Typing "480.000" is not an error: it sends 480, which the server accepts.
// Typing "480.123" is, because that sends 480.123, which the server rejects. Validating what gets
// sent is the only version of this check that can't disagree with the server's own answer.
//
// The point of mirroring server validation client-side is NOT to replace it — billOrder still
// rejects a bad price with a 400. It's so the owner finds out while typing, rather than by pressing
// the irreversible button and reading an error about a body field.
export function validateOverridePrice(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null; // nothing typed is not an error
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Enter a number';
  if (value <= 0) return 'Must be more than ₹0';
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return 'Enter a plain amount, not 1e5';
  const dot = text.indexOf('.');
  if (dot !== -1 && text.length - dot - 1 > MAX_PRICE_DECIMALS) {
    return `At most ${MAX_PRICE_DECIMALS} decimal places`;
  }
  return null;
}

// THE shared derivation. Takes the preview that is on screen plus whatever the owner has typed, and
// answers every question either screen needs to ask: what rows to render, which articles changed,
// whether a PIN is therefore required, what the request body should carry, and what the new pre-tax
// total would be.
//
// `preview`        — GET /api/orders/:id/fulfillment-preview's response, or null.
// `lineItems`      — the order detail's lineItems (getOrder), or null if not loaded yet. Needed
//                    ONLY for the estimated total: the preview carries no piecesPerSet shape.
// `overrides`      — { [productId]: rawTypedString }. Raw strings, not numbers — an input mid-typing
//                    ("4", "48", "480.") is a real state that must round-trip unchanged.
// `costPriceByProductId` — Map<productId, number> for the below-cost warning, or null when the
//                    owner's cost lookup hasn't loaded (or failed). Null simply means no warning.
export function deriveBillPricing({ preview, lineItems = null, overrides = {}, costPriceByProductId = null }) {
  if (!preview) {
    return { articles: [], priceOverrides: [], changedArticles: [], pinRequired: false, hasErrors: false, estimatedPreTax: null };
  }

  // piecesPerSet per LINE, from the order detail. The preview deliberately returns no size shape
  // (it answers stock-and-price questions, not composition), so the estimated total below is the
  // one thing here that needs the order detail at all — every other derivation runs off the preview
  // alone. Cancelled lines are skipped: they are excluded from the backend's own sum too.
  const piecesByLineItemId = new Map();
  if (Array.isArray(lineItems)) {
    for (const li of lineItems) {
      if (li.isCancelled) continue;
      piecesByLineItemId.set(li.id, piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }));
    }
  }

  // Grouped by productId — the ARTICLE — because that is the grain rule 113's override works at:
  // one typed price applies to every live line of that article, every colour. Never grouped by
  // articleNo, which is unique only per Factory (CLAUDE.md's non-negotiable rule), so two
  // factories' identically-numbered articles would silently merge into one price row.
  const byProductId = new Map();
  for (const line of preview.lines) {
    // A null productId cannot happen for a live order (Product is a required relation), but the
    // preview types it as nullable, and an article with no id cannot be named in priceOverrides at
    // all. Such a row is shown read-only rather than given an input that could never be sent.
    const key = line.productId ?? `__unidentified__${line.lineItemId}`;
    let group = byProductId.get(key);
    if (!group) {
      group = {
        productId: line.productId,
        overridable: line.productId != null,
        articleNo: line.articleNo,
        productName: line.productName,
        lines: [],
      };
      byProductId.set(key, group);
    }
    group.lines.push(line);
  }

  const articles = [...byProductId.values()].map((group) => {
    const baselines = group.lines.map((l) => Number(l.billedUnitPrice));
    const baselineMin = Math.min(...baselines);
    const baselineMax = Math.max(...baselines);

    const typed = group.overridable ? (overrides[group.productId] ?? '') : '';
    const error = group.overridable ? validateOverridePrice(typed) : null;
    const typedValue = typed.trim() !== '' && !error ? Number(typed) : null;

    // "Changed" mirrors the server's PER-LINE comparison (rule 113: one article's colours can carry
    // different baselines, because priceAtOrder is snapshotted per line). An article is changed
    // unless the typed price equals EVERY one of its lines' baselines — which, for a real range, no
    // single value can. So a range article with any typed value is changed, exactly as the server
    // will find it to be. A value equal to a single uniform baseline is the documented no-op:
    // no override sent, no PIN, no audit row.
    const changed = typedValue != null && !(baselineMin === typedValue && baselineMax === typedValue);

    const costPrice = group.overridable ? (costPriceByProductId?.get(group.productId) ?? null) : null;
    // Warned on the price that will actually be charged, whether the owner typed it or it came from
    // the location/priceAtOrder resolution. A baseline that is already below cost is exactly as
    // worth knowing at the confirm step as one the owner just typed — this warning has no
    // enforcement role (rule 113: below cost never blocks), so there is no reason to narrow it.
    const effectiveMin = typedValue ?? baselineMin;
    const belowCost = costPrice != null && effectiveMin < costPrice;

    return {
      ...group,
      baselineMin,
      baselineMax,
      hasBaselineRange: baselineMin !== baselineMax,
      typed,
      error,
      typedValue,
      changed,
      costPrice,
      belowCost,
    };
  });

  // Only CHANGED articles reach the request. An override equal to the baseline is deliberately
  // absent rather than sent-and-ignored: the server treats it as a no-op either way, but sending it
  // would make the body claim a change the owner did not make.
  const changedArticles = articles.filter((a) => a.changed);
  const priceOverrides = changedArticles.map((a) => ({ productId: a.productId, unitPrice: a.typedValue }));

  // Same formula as the backend's computeBilledLines — qtySetsPacked × piecesPerSet × unit price,
  // summed over the preview's lines (already scoped to non-cancelled, qtySetsPacked > 0). Labelled
  // an ESTIMATE wherever it is shown, because it is: the server recomputes this from live order
  // data and stores its own answer.
  //
  // `null` rather than a partial sum whenever the piecesPerSet shape isn't available for every line
  // — a total missing one article's contribution is worse than no total, because it looks complete.
  let estimatedPreTax = 0;
  const priceByLineItemId = new Map();
  for (const a of articles) {
    for (const l of a.lines) priceByLineItemId.set(l.lineItemId, a.typedValue ?? Number(l.billedUnitPrice));
  }
  for (const line of preview.lines) {
    const pieces = piecesByLineItemId.get(line.lineItemId);
    if (pieces == null) {
      estimatedPreTax = null;
      break;
    }
    estimatedPreTax += line.needed * pieces * priceByLineItemId.get(line.lineItemId);
  }

  return {
    articles,
    priceOverrides,
    changedArticles,
    // A PIN is needed exactly when at least one article changed. The server decides this
    // independently (by comparing two arrays it computed itself) and will answer 403 MISSING_PIN if
    // this client ever gets it wrong — this flag only decides whether to ASK, never whether to
    // enforce.
    pinRequired: priceOverrides.length > 0,
    hasErrors: articles.some((a) => a.error != null),
    estimatedPreTax,
  };
}
