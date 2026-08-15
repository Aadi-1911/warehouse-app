import { apiFetch } from './client';

// GET /api/parties -> [{ id, name, shopName, location, address, contact, gstNo, isActive }]
// Any authenticated role (04_API_SPEC.md) — unlike POST/deactivate/reactivate, which are
// owner-only. Only this read wrapper exists for now: the Party List screen this backs is a
// read-only slice (create/archive land in a separate follow-up task), so there's nothing yet
// to call the write endpoints for.
export function listParties() {
  return apiFetch('/api/parties');
}
