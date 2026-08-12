import { apiFetch } from './client';

// GET /api/locations -> [{ id, name }]
export function listLocations() {
  return apiFetch('/api/locations');
}

// POST /api/locations -> { id, name }. OWNER only, unlike Factories/Colors — the caller must
// gate this behind the current user's role; the backend 403s otherwise.
export function createLocation(data) {
  return apiFetch('/api/locations', { method: 'POST', body: data });
}
