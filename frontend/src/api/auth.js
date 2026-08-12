// Auth endpoint wrappers. Kept separate from client.js so pages import intent-revealing
// functions ("login") rather than assembling URLs and HTTP verbs inline.
import { apiFetch } from './client';

// POST /api/auth/login -> { token, user }
export function login(username, password) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

// GET /api/auth/me -> { user }
// Used to re-establish who the user is on page load, when all we have is a stored token.
export function getMe() {
  return apiFetch('/api/auth/me');
}
