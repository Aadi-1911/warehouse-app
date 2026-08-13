// The single place every backend call goes through. Centralising it means the JWT-attaching,
// error-unwrapping, and session-expiry rules are written once and can't drift between callers.

// Vite replaces `import.meta.env.VITE_*` at build time. Only variables prefixed VITE_ are
// exposed to browser code — that prefix is a deliberate guardrail so a stray secret in .env
// can't be bundled into the client by accident.
const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// See LEARNING_LOG.md for the full localStorage-vs-alternatives reasoning. Short version:
// staff run this as a phone PWA that gets backgrounded constantly, so in-memory storage would
// log them out all day; sessionStorage has identical XSS exposure with worse ergonomics.
const TOKEN_KEY = 'warehouse_token';

// Fired when the server rejects a token we actually sent — i.e. the session is dead, not just
// "these login credentials were wrong". AuthProvider listens for this so an expired token
// updates React state instead of leaving a logged-out user staring at a logged-in UI.
export const SESSION_EXPIRED_EVENT = 'warehouse:session-expired';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Carries the backend's own error `code` alongside the message, so callers can branch on a
// stable identifier (INVALID_CREDENTIALS, PIN_LOCKED, ...) rather than string-matching prose.
// `extra` carries any sibling fields sendError() attached beyond { code, message } — e.g.
// requirePin's attemptsRemaining on an INVALID_PIN response — undefined when there are none.
export class ApiError extends Error {
  constructor(message, code, status, extra) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export async function apiFetch(path, { method = 'GET', body, ...rest } = {}) {
  const token = getToken();
  const headers = { ...rest.headers };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects on network-level failure (server down, DNS, offline) — an HTTP 500
    // is a *successful* fetch with a bad status, handled further down.
    throw new ApiError('Could not reach the server. Check your connection.', 'NETWORK_ERROR', 0);
  }

  // A token we sent was rejected => the session itself is over. Guarding on `token` matters:
  // a failed login also returns 401, but there's no session to tear down in that case.
  if (response.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  if (response.status === 204) return null;

  // Tolerates a non-JSON body (proxy error pages, empty responses) instead of throwing a
  // confusing SyntaxError that would mask the real HTTP failure.
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Every backend endpoint returns { error: { code, message } } (04_API_SPEC.md), so this
    // unwraps that one shape rather than each caller re-deriving it. sendError() sometimes
    // attaches sibling fields alongside `error` (e.g. { error, attemptsRemaining }) — everything
    // except `error` itself is passed through as `extra`, undefined when there's nothing there.
    const { error: _error, ...extra } = data ?? {};
    throw new ApiError(
      data?.error?.message ?? `Request failed (${response.status})`,
      data?.error?.code ?? 'UNKNOWN_ERROR',
      response.status,
      Object.keys(extra).length ? extra : undefined
    );
  }

  return data;
}
