import { apiFetch } from './client';

// Good Returns — whole sets coming back from a Party (05_BUSINESS_RULES.md rule 86).
// Both endpoints are open to any authenticated role: taking returned goods at the counter is a
// staff job, same as receiving stock or placing an order.

// GET /api/returns -> [{ id, partyId, partyName, bundleId, productId, productArticleNo,
// productName, colorId, colorName, locationId, locationName, qtySets, priceAtReturn, reason,
// note, createdAt, userId, userName }] — newest first, no filters.
export function listReturns() {
  return apiFetch('/api/returns');
}

// POST /api/returns -> the created returns, as an ARRAY (one entry per line), in the order they
// were submitted. All-or-nothing: one bad line rejects the whole request and creates nothing, so
// a partial success is not a state this can return.
//
// priceAtReturn is deliberately NOT sent — the server reads Product.sellingPrice itself at write
// time and would ignore anything supplied here. Same for the reason labels: the server takes the
// raw GoodReturnReason enum value, never the human wording shown on screen.
export function createReturns({ partyId, locationId, lines }) {
  return apiFetch('/api/returns', { method: 'POST', body: { partyId, locationId, lines } });
}
