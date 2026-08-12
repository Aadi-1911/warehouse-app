// Holds "who is logged in" for the whole app. Lives in /hooks rather than a new /context
// folder to stay within the structure 02_ARCHITECTURE.md §6 documents.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login as loginRequest, getMe } from '../api/auth';
import { setToken, clearToken, getToken, SESSION_EXPIRED_EVENT } from '../api/client';

// Context = a value any descendant component can read without it being threaded down through
// every intermediate component as props. Auth is the textbook case: many screens need the
// current user, and almost none of the components in between care about it.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // Three states, not a boolean. On a hard refresh we hold a token but don't yet know if it's
  // valid, and that in-between moment needs its own value — see ProtectedRoute for why
  // collapsing it into `isLoggedIn: false` would bounce every refresh to the login screen.
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'

  // Rehydrate on mount. We deliberately persist ONLY the token, never the user object: the
  // role decides what this account may see, so it gets re-read from the server on every load
  // rather than trusted from client-side storage a user could simply edit in devtools.
  // The round-trip doubles as a liveness check — an expired token fails here, at load, rather
  // than surfacing later in the middle of a real action.
  useEffect(() => {
    if (!getToken()) {
      setStatus('unauthenticated');
      return;
    }

    // React StrictMode runs effects twice in development to surface exactly this kind of bug;
    // the flag stops a resolved response from a discarded run writing to state after unmount.
    let cancelled = false;

    getMe()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setUser(null);
        setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A token rejected mid-session (expiry, or the account was deleted) clears storage down in
  // client.js. This mirrors that into React state so the UI actually reacts, instead of
  // rendering a logged-in shell whose every request now fails.
  useEffect(() => {
    function handleSessionExpired() {
      setUser(null);
      setStatus('unauthenticated');
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  // Not wrapped in try/catch: a failed login is the Login screen's business to display, so the
  // ApiError is left to propagate to the caller that can actually show it.
  const login = useCallback(async (username, password) => {
    const { token, user: loggedInUser } = await loginRequest(username, password);
    setToken(token);
    setUser(loggedInUser);
    setStatus('authenticated');
    return loggedInUser;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Re-fetches "who am I" from the server and updates state — for when something about the
  // logged-in user's own account changes mid-session in a way other than logging in/out (e.g.
  // SetPin.jsx setting a PIN, which flips hasPinSet). Without this, the new value would only
  // ever show up after a full page reload re-ran the mount effect above.
  const refreshUser = useCallback(async () => {
    const data = await getMe();
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  // Turns a confusing downstream "cannot read property of null" into a message that names the
  // actual mistake: the component was rendered outside the provider.
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>');
  return context;
}
