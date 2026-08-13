import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { WalletIcon, KeyIcon } from '../components/icons';
import { listFactories, getFactoryPayable } from '../api/factories';
import { createFactoryPayment } from '../api/factoryPayments';

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function todayInputValue() {
  // Local calendar date, not toISOString()'s UTC date — a receipt entered late at night in an
  // IST-ahead-of-UTC timezone must default to "today" as the owner sees it, not tomorrow.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Factory Payables — 07_UI_DESIGN_BRIEF.md §5.8. Owner-only screen, own Home tile. Backed by
// GET /api/factories/:id/payable and POST /api/factory-payments (both owner-only; the POST is
// now also PIN-gated — see LEARNING_LOG.md for why that changed mid-task).
export default function FactoryPayables() {
  const { user } = useAuth();

  // 'idle' | 'loading' | 'loaded' — never a bare boolean (CLAUDE.md's standing rule): this
  // fetch kicks off from an effect that runs AFTER the first render, so a boolean would make
  // "haven't asked yet" indistinguishable from "asked, found nothing" for one render.
  const [factories, setFactories] = useState([]);
  const [factoriesStatus, setFactoriesStatus] = useState('idle');
  const [factoriesError, setFactoriesError] = useState(null);

  const [factoryId, setFactoryId] = useState('');

  // Same three-state shape, same reason — this is the "which factory am I looking at" fetch
  // that switching the dropdown must never let a slow response answer for the wrong factory.
  const [payable, setPayable] = useState(null);
  const [payableStatus, setPayableStatus] = useState('idle');
  const [payableError, setPayableError] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInputValue);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setFactoriesStatus('loading');
    listFactories()
      .then((list) => {
        if (cancelled) return;
        // Archived factories are hidden from this picker (rule 85) — recording a new payment
        // against one shouldn't be offered, even though its history stays visible forever
        // through whichever active factory it's actually filed under.
        setFactories(list.filter((f) => f.isActive));
      })
      .catch((err) => {
        if (!cancelled) setFactoriesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setFactoriesStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches whenever the selected factory changes. The FIRST thing this does, synchronously
  // on the same render that reacts to the id changing, is drop back to 'loading' with payable
  // cleared — so a slow response for factory A can never render while factory B is selected,
  // and no stale numbers are ever visible mid-switch (§5.8's explicit requirement, same
  // discipline as Transfer.jsx's source-location switch).
  useEffect(() => {
    if (!factoryId) {
      setPayableStatus('idle');
      setPayable(null);
      setPayableError(null);
      return;
    }

    let cancelled = false;
    setPayableStatus('loading');
    setPayable(null);
    setPayableError(null);

    getFactoryPayable(factoryId)
      .then((data) => {
        if (!cancelled) setPayable(data);
      })
      .catch((err) => {
        if (!cancelled) setPayableError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPayableStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId]);

  function handleFactoryChange(newId) {
    setFactoryId(newId);
    // Any in-progress payment form belonged to the PREVIOUS factory's context — closing it
    // rather than silently re-pointing it at a different factory avoids paying the wrong one.
    setFormOpen(false);
    resetPaymentForm();
    setSuccessMessage(null);
  }

  function resetPaymentForm() {
    setAmount('');
    setDate(todayInputValue());
    setNote('');
    setPin('');
    setSubmitError(null);
    setAttemptsRemaining(null);
  }

  async function handleSubmitPayment(event) {
    event.preventDefault();
    setSubmitError(null);
    setAttemptsRemaining(null);

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setSubmitError('Enter a valid amount.');
      return;
    }
    if (!date) {
      setSubmitError('Enter a date.');
      return;
    }
    if (!pin) {
      setSubmitError('Enter your PIN.');
      return;
    }

    setSubmitting(true);
    try {
      await createFactoryPayment({
        factoryId,
        amount: parsedAmount,
        date,
        note: note.trim() || undefined,
        pin,
      });
      setSuccessMessage(`Payment of ${formatCurrency(parsedAmount)} recorded.`);
      setFormOpen(false);
      resetPaymentForm();
      // Re-fetch so the stats/history reflect the payment just made, rather than showing
      // totals that are now stale by exactly the amount just recorded.
      setPayableStatus('loading');
      const fresh = await getFactoryPayable(factoryId);
      setPayable(fresh);
      setPayableStatus('loaded');
    } catch (err) {
      // INVALID_PIN carries attemptsRemaining as a sibling field (see client.js's ApiError.extra)
      // — surfacing it here is the whole reason that field exists, for a lockout-prone action.
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setAttemptsRemaining(err.extra.attemptsRemaining);
      }
      setSubmitError(err.message);
      // Never leave a wrong PIN sitting in the field for a retry — re-typing it fresh each
      // attempt is the same friction SetPin.jsx already accepts for the same reason.
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  const showStats = factoryId && payableStatus === 'loaded' && !payableError && payable;

  return (
    <div className="page">
      <header className="screen-header">
        <div className="icon-mark accent">
          <WalletIcon size={20} />
        </div>
        <div>
          <div className="eyebrow">Warehouse</div>
          <h1 className="screen-title">Factory Payables</h1>
        </div>
      </header>

      {factoriesError && (
        <p className="error-banner" role="alert">
          Could not load factories: {factoriesError}
        </p>
      )}

      <label className="field">
        <span className="field-label">Factory</span>
        <select
          value={factoryId}
          onChange={(e) => handleFactoryChange(e.target.value)}
          disabled={factoriesStatus !== 'loaded' || submitting}
        >
          <option value="">{factoriesStatus !== 'loaded' ? 'Loading…' : 'Select a factory'}</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      {successMessage && (
        <div className="result-banner result-banner-success">
          <p>{successMessage}</p>
          <button type="button" className="link-button" onClick={() => setSuccessMessage(null)}>
            OK
          </button>
        </div>
      )}

      {!factoryId && <p className="muted centered-empty-state">Select a factory to see what's owed.</p>}

      {factoryId && payableStatus !== 'loaded' && <p className="muted centered-empty-state">Loading…</p>}

      {factoryId && payableStatus === 'loaded' && payableError && (
        <p className="error-banner" role="alert">
          Could not load payables: {payableError}
        </p>
      )}

      {showStats && (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(payable.totalOwed)}</span>
              <span className="stat-label">Total owed</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(payable.totalPaid)}</span>
              <span className="stat-label">Total paid</span>
            </div>
          </div>

          <div className="stat-hero">
            <span className="stat-hero-value">{formatCurrency(payable.amountPayable)}</span>
            <span className="stat-hero-label">Amount payable</span>
          </div>

          <div className="card">
            <h2 className="card-title">Payment history</h2>
            {payable.payments.length === 0 ? (
              <p className="muted centered-empty-state">No payments recorded yet.</p>
            ) : (
              payable.payments.map((p) => (
                <div key={p.id} className="payment-history-row">
                  <div className="payment-history-meta">
                    <span className="payment-history-date">{formatDate(p.date)}</span>
                    {p.note && <span className="payment-history-note">{p.note}</span>}
                  </div>
                  {/* p.amount is a raw Prisma Decimal — arrives as a STRING ("250.5"), not a
                      number (see api/factories.js). formatCurrency() Number()s it internally. */}
                  <span className="payment-history-amount">{formatCurrency(p.amount)}</span>
                </div>
              ))
            )}
          </div>

          {!formOpen && !user.hasPinSet && (
            <Link to="/set-pin" className="prompt-banner prompt-banner-warning">
              <KeyIcon size={18} />
              <span>Set your price-edit PIN to record a factory payment.</span>
            </Link>
          )}

          {formOpen && (
            <div className="card">
              <h2 className="card-title">Record payment</h2>
              {/* Lightweight inline PIN prompt, not the standard ConfirmModal (§5.8) — the PIN
                  field IS the confirmation step here, one form and one button rather than a
                  form followed by a separate overlay. */}
              <form onSubmit={handleSubmitPayment}>
                <label className="field">
                  <span className="field-label">Amount</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field-label">Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field-label">Note (optional)</span>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Bank transfer, Cash"
                    disabled={submitting}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Your PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                    required
                  />
                </label>

                {submitError && (
                  <p className="error-banner" role="alert">
                    {submitError}
                    {attemptsRemaining != null &&
                      ` (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`}
                  </p>
                )}

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Recording…' : 'Confirm payment'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFormOpen(false);
                    resetPaymentForm();
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {!formOpen && (
            <div className="sticky-action-bar">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setFormOpen(true)}
                disabled={!user.hasPinSet}
              >
                Record payment
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
