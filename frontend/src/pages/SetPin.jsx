import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { KeyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { setOwnPin } from '../api/users';

// Set/Change your PIN — one screen, two modes, decided by user.hasPinSet at the moment it
// loads (01_PRD.md §95: "A newly created owner account has no PIN yet; setting it is a
// separate self-service action the new owner does themselves" — changing an existing one is
// the same self-service idea, just reached once that first step is already done). Home.jsx
// only ever links here via "Set PIN" (hasPinSet false) or "Change PIN" (hasPinSet true) —
// exact inverse conditions, so whichever mode this screen picks always matches how it was
// reached. PATCH /api/users/me/pin already required currentPin whenever a PIN exists; this
// screen previously just never collected it and redirected away instead — the gap was
// reachability, not backend logic (see LEARNING_LOG.md).
export default function SetPin() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const changingExisting = user.hasPinSet;

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setAttemptsRemaining(null);

    if (newPin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setSubmitting(true);
    try {
      // currentPin is only meaningful (and only sent — see setOwnPin) when changing an existing
      // PIN; first-time setup has nothing to verify against.
      await setOwnPin({ newPin, currentPin: changingExisting ? currentPin : undefined });
      await refreshUser(); // keeps hasPinSet in sync, so Home's Set/Change PIN row swaps immediately
      navigate('/', { replace: true });
    } catch (err) {
      // INVALID_PIN carries attemptsRemaining as a sibling field (client.js's ApiError.extra) —
      // same lockout-prone-action convention as every other PIN gate in this app.
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setAttemptsRemaining(err.extra.attemptsRemaining);
      }
      setError(err.message);
      // Never leave a wrong PIN sitting in a field for a retry, same reasoning used everywhere
      // else a PIN gates an action (Factory Payables, Article Pricing).
      setCurrentPin('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="card login-card">
        <ScreenHeader
          icon={<KeyIcon size={20} />}
          tone="warning"
          title={changingExisting ? 'Change your PIN' : 'Set your PIN'}
        />

        <p className="muted hint-text">
          This PIN is required whenever you edit a cost price or selling price. Only you will
          know it — no one else, including whoever created your account.
        </p>

        <form onSubmit={handleSubmit}>
          {changingExisting && (
            <label className="field">
              <span className="field-label">Current PIN</span>
              <input
                type="password"
                inputMode="numeric"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                autoComplete="off"
                disabled={submitting}
                required
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">New PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
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
              disabled={submitting}
              required
            />
          </label>

          {error && (
            <p className="error-banner" role="alert">
              {error}
              {attemptsRemaining != null &&
                ` (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : changingExisting ? 'Change PIN' : 'Set PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}
