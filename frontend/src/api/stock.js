import { apiFetch } from './client';

// GET /api/stock?articleNo=&colorId=&locationId= -> [{ bundleId, productId, productArticleNo,
// colorName, locationId, locationName, qtySets }]
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
export function listStock({ articleNo, colorId, locationId } = {}) {
  const params = new URLSearchParams();
  if (articleNo) params.set('articleNo', articleNo);
  if (colorId) params.set('colorId', colorId);
  if (locationId) params.set('locationId', locationId);
  const query = params.toString();
  return apiFetch(`/api/stock${query ? `?${query}` : ''}`);
}
