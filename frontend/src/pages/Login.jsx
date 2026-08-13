import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ScreenHeader from '../components/ScreenHeader';

export default function Login() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // "Controlled inputs": React state is the single source of truth for the field's value, and
  // the DOM only ever reflects it. Reading values off the DOM at submit time instead would
  // leave two copies of the truth that can disagree.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Where the user was headed before being bounced here by ProtectedRoute.
  const from = location.state?.from?.pathname || '/';

  // Someone already logged in has no business on the login screen — e.g. hitting Back after
  // signing in. Rendered as a redirect rather than an effect so it happens during render,
  // before the form can flash on screen.
  if (status === 'authenticated') {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event) {
    // Without this the browser does a full-page form GET and blows away the React app.
    event.preventDefault();

    setError(null);
    setSubmitting(true);

    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      // The backend deliberately returns the same message for unknown-user and wrong-password
      // so the screen can't be used to discover which usernames exist.
      setError(err.message);
    } finally {
      // Runs on both paths, so a failed attempt always re-enables the button.
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="card login-card">
        {/* Login is unauthenticated and isn't behind ProtectedRoute, so it also opts out of the
            default back-to-Home link (showBackLink={false}) — a link to "/" here would just hit
            ProtectedRoute's redirect and bounce straight back to this same screen. See
            ScreenHeader.jsx. */}
        <ScreenHeader
          icon={<span aria-hidden="true">◧</span>}
          title="Sign in"
          showBackLink={false}
        />

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {/* role="alert" makes screen readers announce the failure rather than silently
              rendering text a non-sighted user would never learn about. */}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
