import { apiFetch } from './client';

// GET /api/colors -> [{ id, name }]
// The unfiltered global list — used only where every color is a legitimate option (creating a
// Bundle for a brand-new article). Everywhere else, colors come scoped to a specific product
// via getValidColors, per Critical Interaction Rule #5.
export function listColors() {
  return apiFetch('/api/colors');
}

// POST /api/colors -> { id, name }. Open to any authenticated role.
export function createColor(data) {
  return apiFetch('/api/colors', { method: 'POST', body: data });
}
