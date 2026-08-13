import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { KeyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { setOwnPin } from '../api/users';

// Set your PIN — self-service first-time PIN setup, for an owner whose priceEditPinHash is
// currently null (01_PRD.md §95: "A newly created owner account has no PIN yet; setting it is
// a separate self-service action the new owner does themselves"). Scoped deliberately to just
// this first-time case — no currentPin field, since PATCH /api/users/me/pin only asks for one
// when a PIN already exists. Changing an EXISTING PIN is a different, not-yet-built screen.
export default function SetPin() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // This screen only makes sense for the specific "no PIN yet" case — if it's somehow reached
  // with a PIN already set (e.g. a stale bookmark), submitting would just fail with
  // MISSING_PIN (this screen never collects currentPin), a confusing dead end. Redirect home
  // instead of showing a form that can't succeed.
  if (user.hasPinSet) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (newPin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await setOwnPin({ newPin });
      await refreshUser(); // flips hasPinSet, so the Home banner and this screen's own guard update immediately
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="card login-card">
        <ScreenHeader icon={<KeyIcon size={20} />} tone="warning" title="Set your PIN" />

        <p className="muted hint-text">
          This PIN is required whenever you edit a cost price or selling price. Only you will
          know it — no one else, including whoever created your account.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">New PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Confirm PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Set PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}
