import { apiFetch } from './client';

// GET /api/parties -> [{ id, name, shopName, location, address, contact, gstNo, isActive }]
// Any authenticated role (04_API_SPEC.md) — unlike POST/deactivate/reactivate below, which are
// owner-only. The Party List screen itself is route-gated OWNER, so this is defense in depth,
// not a new restriction.
export function listParties() {
  return apiFetch('/api/parties');
}

// POST /api/parties -> the created party (same shape as above). Only `name` is required —
// rest are optional per the schema's minimal Phase 1 form (rule 17: a walk-in/one-off party
// shouldn't need a full profile before it can be recorded).
export function createParty({ name, shopName, location, address, contact, gstNo }) {
  return apiFetch('/api/parties', { method: 'POST', body: { name, shopName, location, address, contact, gstNo } });
}

// PATCH /api/parties/:id/deactivate -> the updated party. No PIN — archiving isn't a price
// action, same rule as every other archive/reactivate action in this app.
export function deactivateParty(id) {
  return apiFetch(`/api/parties/${id}/deactivate`, { method: 'PATCH' });
}

// PATCH /api/parties/:id/reactivate -> the updated party.
export function reactivateParty(id) {
  return apiFetch(`/api/parties/${id}/reactivate`, { method: 'PATCH' });
}
