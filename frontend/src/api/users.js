import { apiFetch } from './client';

// GET /api/users -> [{ id, name, username, role, isActive, isPrimaryOwner }]
export function listUsers() {
  return apiFetch('/api/users');
}

// POST /api/users -> the created user (same shape as above)
export function createUser({ name, username, password, role }) {
  return apiFetch('/api/users', { method: 'POST', body: { name, username, password, role } });
}

// PATCH /api/users/:id/deactivate -> the updated user
export function deactivateUser(id) {
  return apiFetch(`/api/users/${id}/deactivate`, { method: 'PATCH' });
}

// PATCH /api/users/:id/reactivate -> the updated user
export function reactivateUser(id) {
  return apiFetch(`/api/users/${id}/reactivate`, { method: 'PATCH' });
}

// PATCH /api/users/me/pin -> { message }. currentPin is only required when the account
// already has a PIN set — omit it entirely for first-time setup.
export function setOwnPin({ newPin, currentPin } = {}) {
  const body = { newPin };
  if (currentPin) body.currentPin = currentPin;
  return apiFetch('/api/users/me/pin', { method: 'PATCH', body });
}
