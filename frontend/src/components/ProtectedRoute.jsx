import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// Wraps any route that requires a logged-in user, optionally restricted to one role.
// This is a UX convenience, not a security boundary — the real enforcement is server-side on
// every API call (requireRole in the backend). A STAFF user editing localStorage to bypass
// this would just see an empty shell, since every actual API response still checks role
// independently. This exists so a legitimate user doesn't land on a broken screen, the same
// reasoning already logged for why the Home tile grid only links to screens that exist.
export default function ProtectedRoute({ children, requireRole }) {
  const { status, user } = useAuth();
  const location = useLocation();

  // The load-bearing branch. On a hard refresh the token check is still in flight, and
  // treating that as "not logged in" would redirect to /login for a split second before the
  // /me call resolves — the classic symptom being a login-screen flash on every refresh.
  if (status === 'loading') {
    return <div className="centered-screen muted">Loading…</div>;
  }

  if (status !== 'authenticated') {
    // `state` remembers where they were headed so login can send them back there, and
    // `replace` keeps the guarded URL out of history — otherwise Back lands on a redirect loop.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireRole && user.role !== requireRole) {
    return <Navigate to="/" replace />;
  }

  return children;
}
