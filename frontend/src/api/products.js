import { apiFetch } from './client';

// GET /api/products?factoryId=&articleNo= -> Product[]
// Raw wrapper — returns whatever the backend matches. See findExactMatch below for why this
// alone isn't enough to answer "does this article already exist."
export function listProducts({ factoryId, articleNo } = {}) {
  const params = new URLSearchParams();
  if (factoryId) params.set('factoryId', factoryId);
  if (articleNo) params.set('articleNo', articleNo);
  const query = params.toString();
  return apiFetch(`/api/products${query ? `?${query}` : ''}`);
}

// The article-lookup step (07_UI_DESIGN_BRIEF.md §5.2) needs an EXACT match scoped to one
// Factory — articleNo is unique per (articleNo, factoryId) in the schema, so at most one
// product can genuinely match. But the backend's `?articleNo=` filter does a case-insensitive
// *contains* match (productController.js), meant for a search box, not an exact lookup — so
// searching "TEST01" would also return a "TEST010" if one existed. This finds the one exact
// match (if any) out of whatever the backend returns, rather than trusting the first result.
export async function findExactMatch(factoryId, articleNo) {
  const trimmed = articleNo.trim();
  const results = await listProducts({ factoryId, articleNo: trimmed });
  return results.find((p) => p.articleNo.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

// GET /api/products/:id/valid-colors -> [{ id, name, bundleId }]
// Scoped to this specific product's actual Bundles, not the global Color list — Critical
// Interaction Rule #5 (07_UI_DESIGN_BRIEF.md §4): never show colors an article doesn't have.
export function getValidColors(productId) {
  return apiFetch(`/api/products/${productId}/valid-colors`);
}

// POST /api/products -> the created Product (same shape as a GET). No price fields — this
// wrapper is only ever used for the New-article branch of Receive Stock, which explicitly
// never sets costPrice/sellingPrice at creation (pricing is a separate, PIN-gated owner action).
export function createProduct({ articleNo, factoryId, name, categoryId, isKids, sizes }) {
  return apiFetch('/api/products', { method: 'POST', body: { articleNo, factoryId, name, categoryId, isKids, sizes } });
}

// PATCH /api/products/:id -> the updated Product. Used for Article Pricing's price edits —
// costPrice/sellingPrice in the body means the backend requires OWNER role AND a PIN match
// (`pin` in the body), enforced by requirePinForPriceEdits (routes/products.js) — and, since
// 2026-08-28, for article renames (`name`), which are OWNER-only but take NO pin, since rule 71's
// gate is about money and a name carries none.
//
// Written as an explicit whitelist rather than a pass-through `body` so this client can never
// forward a field the endpoint doesn't accept. `name` HAD to be added here as well as to the
// server's PATCHABLE_FIELDS: the old signature destructured only { costPrice, sellingPrice, pin },
// so a rename call silently sent `{}` and the server correctly rejected it with "No editable
// fields provided" — a real bug caught in browser testing, not by the build, since dropping an
// undeclared property is perfectly valid JS.
//
// undefined keys are stripped by apiFetch's own JSON.stringify, so a name-only call sends exactly
// { name } with no stray nulls, and a price-only call is unchanged from before.
export function updateProduct(id, { costPrice, sellingPrice, name, pin }) {
  return apiFetch(`/api/products/${id}`, { method: 'PATCH', body: { costPrice, sellingPrice, name, pin } });
}

// PATCH /api/products/:id/location-pricing -> the updated Product (same shape as any other GET/
// PATCH here, including hasLocationPricing/locationPrices). OWNER only, deliberately NO pin —
// this flag only selects which already-PIN-gated price gets read at billing, it writes no money
// itself (rule 111, setLocationPricingEnabled in productController.js). Written as its own
// two-arg function rather than folded into updateProduct()'s body, matching that endpoint's own
// separate route (PATCH /api/products/:id/location-pricing, not PATCH /api/products/:id) —
// 05_BUSINESS_RULES.md rule 111 is explicit that this flag was deliberately NOT nested into the
// existing PATCH body, specifically so a body-shape PIN sniff could never miss it.
export function setLocationPricingEnabled(id, hasLocationPricing) {
  return apiFetch(`/api/products/${id}/location-pricing`, { method: 'PATCH', body: { hasLocationPricing } });
}

// PUT /api/products/:id/location-prices/:locationId -> the saved LocationPrice row ({ id,
// locationId, location: { id, name }, sellingPrice, updatedAt }) — NOT a Product, a narrower
// response than every other write in this file, matching what setLocationPrice actually returns
// server-side (productController.js). OWNER + PIN UNCONDITIONALLY, via requirePin directly
// (routes/products.js) rather than updateProduct's body-sniffing requirePinForPriceEdits — this
// endpoint's entire body is a price, so there's nothing to sniff for.
//
// Written as an explicit { sellingPrice, pin } whitelist, same reasoning updateProduct's own
// comment gives: this client can then never forward a field the endpoint doesn't accept, in
// particular costPrice — the server 400s on it (cost is global, rule 111; set it via
// updateProduct() above instead). `sellingPrice: null` is the supported way to CLEAR an override
// (falls back to the article's own base price at billing) — it is a real, meaningful value here,
// not "no value provided", so callers pass it explicitly rather than omitting the key.
export function setLocationPrice(id, locationId, { sellingPrice, pin }) {
  return apiFetch(`/api/products/${id}/location-prices/${locationId}`, {
    method: 'PUT',
    body: { sellingPrice, pin },
  });
}

// PATCH /api/products/:id/deactivate -> the updated Product ({ ...fields, isActive }). Any
// authenticated role, no PIN — deactivate is never a price action, matching every other
// archive/reactivate action in this app. Archives the WHOLE article, all its colors together
// (never per-color) — see productController.js.
export function deactivateProduct(id) {
  return apiFetch(`/api/products/${id}/deactivate`, { method: 'PATCH' });
}

// PATCH /api/products/:id/reactivate -> the updated Product ({ ...fields, isActive }).
export function reactivateProduct(id) {
  return apiFetch(`/api/products/${id}/reactivate`, { method: 'PATCH' });
}
