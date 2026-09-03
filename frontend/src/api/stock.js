import { apiFetch } from './client';

// GET /api/stock?articleNo=&colorId=&locationId= -> [{ bundleId, productId, productArticleNo,
// productName, productIsActive, factoryId, factoryName, colorName, locationId, locationName,
// qtySets }]
//
// This endpoint has never filtered out archived articles, and still doesn't — an archived
// article holding real unsold stock is still real stock, and every quantity/value figure built
// on it must keep counting it (rule 85's "never hard-deleted" extended to reporting, 2026-08-28).
// `productIsActive` is what lets a caller SEPARATE those rows rather than lose them: Live Stock
// uses it to keep archived articles out of the main list while giving them their own opt-in
// section. Note that callers which say nothing about it (Transfer, both Low Stock screens)
// behave exactly as they did before — adding a field changes nothing for code that ignores it.
//
// Live Stock View calls this with no filters and searches client-side (its search matches
// article OR colour, which doesn't map cleanly onto this endpoint's colorId-by-id param), so
// the full list is fetched once and grouped/searched locally.
//
// Transfer calls it with { locationId } instead — there, the source location isn't a search
// refinement over everything, it's the boundary of what the screen is even allowed to act on,
// so scoping it server-side keeps the payload proportional to one location's holdings and
// makes "every row shown is transferable" true by construction rather than by remembering to
// filter. Both callers are correct for their own case; the param is optional either way.
//
// factoryId/factoryName let Transfer group its already-scoped rows by Factory client-side
// without a second fetch — no separate listFactories() join needed the way LiveStock.jsx does
// its own factory grouping (07_UI_DESIGN_BRIEF.md §5.9 amendment).
export function listStock({ articleNo, colorId, locationId } = {}) {
  const params = new URLSearchParams();
  if (articleNo) params.set('articleNo', articleNo);
  if (colorId) params.set('colorId', colorId);
  if (locationId) params.set('locationId', locationId);
  const query = params.toString();
  return apiFetch(`/api/stock${query ? `?${query}` : ''}`);
}
