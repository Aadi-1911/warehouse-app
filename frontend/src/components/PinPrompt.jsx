import { useState } from 'react';

// Shared owner-PIN entry: the field, the submit button, and — the part actually worth sharing —
// the INVALID_PIN error rendering with its "(N attempts remaining)" suffix, which the backend
// sends as a sibling `attemptsRemaining` field (surfaced by client.js's ApiError.extra).
//
// Provenance, since the task that created this asked to "reuse the existing PIN-entry component":
// there wasn't one. The "lightweight inline PIN prompt" pattern (07_UI_DESIGN_BRIEF.md §5.8/§5.10)
// existed only as hand-copied inline markup in THREE places — ArticlePricing's price edit, and
// both of FactoryPayables' forms (record payment, record debit). This component is that pattern
// extracted for real, so the dashboard lock screen (its first user) isn't a fourth copy.
//
// The three existing copies are deliberately NOT refactored onto this in the same task that
// introduced it: in all three, the PIN field sits INSIDE a larger form alongside other required
// inputs (cost/selling price, amount, note) and shares that form's single submit button — so it
// isn't a drop-in swap, it's a restructure of three working, PIN-gated screens, which deserves
// its own task and its own testing rather than riding along on a feature change.
//
// Deliberately owns the pin value in local state rather than lifting it to the caller: every
// caller so far wants exactly the same thing (clear the field on failure so a wrong PIN is never
// left sitting there for a retry — the reasoning ArticlePricing, FactoryPayables and SetPin all
// already apply independently), and there's no case yet for a caller reading it mid-typing.
export default function PinPrompt({
  label = 'Your PIN',
  submitLabel = 'Unlock',
  submittingLabel = 'Checking…',
  autoFocus = false,
  onSubmit,
}) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!pin) {
      setError('Enter your PIN.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setAttemptsRemaining(null);
    try {
      await onSubmit(pin);
      // No cleanup on success on purpose — a successful unlock unmounts this component, so
      // clearing state here would be a write to a component that's about to disappear.
    } catch (err) {
      setError(err.message);
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setAttemptsRemaining(err.extra.attemptsRemaining);
      }
      // Never leave a wrong PIN in the field for a retry — same reasoning the three existing
      // inline copies each apply on their own.
      setPin('');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="off"
          autoFocus={autoFocus}
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
        {submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
