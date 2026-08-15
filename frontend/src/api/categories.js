import { apiFetch } from './client';

// GET /api/categories -> [{ id, name, isActive }]
export function listCategories() {
  return apiFetch('/api/categories');
}

// POST /api/categories -> { id, name, isActive }. Open to any authenticated role.
export function createCategory(data) {
  return apiFetch('/api/categories', { method: 'POST', body: data });
}

// PATCH /api/categories/:id/deactivate -> the updated category ({ id, name, isActive }). Open
// to any authenticated role, no PIN — matches every other archive/reactivate action in this
// app (only price edits require a PIN). Soft-deactivate only, idempotent.
export function deactivateCategory(id) {
  return apiFetch(`/api/categories/${id}/deactivate`, { method: 'PATCH' });
}

// PATCH /api/categories/:id/reactivate -> the updated category ({ id, name, isActive }).
export function reactivateCategory(id) {
  return apiFetch(`/api/categories/${id}/reactivate`, { method: 'PATCH' });
}
