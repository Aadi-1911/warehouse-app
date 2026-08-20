import { apiFetch } from './client';

// GET /api/locations -> [{ id, name, isActive, profitSharePercent }]. isActive/profitSharePercent
// added 2026-08-20 (location-attributed revenue/profit split) — corrected here since this comment
// previously undercounted the response shape.
export function listLocations() {
  return apiFetch('/api/locations');
}

// POST /api/locations -> { id, name, isActive, profitSharePercent }. OWNER only, unlike
// Factories/Colors — the caller must gate this behind the current user's role; the backend 403s
// otherwise.
export function createLocation(data) {
  return apiFetch('/api/locations', { method: 'POST', body: data });
}

// PATCH /api/locations/:id/profit-share -> the updated location. OWNER only, no PIN (an admin
// setting on Location, not a costPrice/sellingPrice edit — see 04_API_SPEC.md). Body must be an
// integer 0-100; the backend validates and 400s otherwise.
export function updateLocationProfitShare(id, profitSharePercent) {
  return apiFetch(`/api/locations/${id}/profit-share`, { method: 'PATCH', body: { profitSharePercent } });
}

// GET /api/locations/revenue?period=month|six_months|fy|all -> { period, label, locations: [{
// locationId, locationName, isActive, profitSharePercent, stockValue, revenue, profit }] }.
// OWNER only. Every location's figures come back in one call — see 04_API_SPEC.md for why this
// isn't scoped to a single id.
export function getLocationsRevenue({ period }) {
  return apiFetch(`/api/locations/revenue?period=${encodeURIComponent(period)}`);
}
