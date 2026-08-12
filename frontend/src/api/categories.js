import { apiFetch } from './client';

// GET /api/categories -> [{ id, name }]
export function listCategories() {
  return apiFetch('/api/categories');
}

// POST /api/categories -> { id, name }. Open to any authenticated role.
export function createCategory(data) {
  return apiFetch('/api/categories', { method: 'POST', body: data });
}
