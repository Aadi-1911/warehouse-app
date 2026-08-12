import { apiFetch } from './client';

// GET /api/factories -> [{ id, name, contact }]
export function listFactories() {
  return apiFetch('/api/factories');
}

// POST /api/factories -> { id, name, contact, gstNo }. Open to any authenticated role — see
// factoryController.js: "Factories grow via normal usage, no OWNER gate."
export function createFactory(data) {
  return apiFetch('/api/factories', { method: 'POST', body: data });
}
