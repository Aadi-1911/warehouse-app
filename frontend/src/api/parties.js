import { apiFetch } from './client';

// GET /api/parties -> [{ id, name, shopName, location, address, contact, gstNo, isActive }]
// Any authenticated role (04_API_SPEC.md). Read by the Party List screen and by every screen
// that picks a Party — New Order and Good Returns both do.
//
// (This comment used to say POST was owner-only and that the Party List screen was route-gated
// OWNER. Both stopped being true on 2026-08-18 when Manage Parties opened to staff — corrected
// here rather than left to mislead.)
export function listParties() {
  return apiFetch('/api/parties');
}

// POST /api/parties -> the created party (same shape as above). Any authenticated role since
// 2026-08-18 — staff need to add a walk-in customer mid-order. Only `name` is required —
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
