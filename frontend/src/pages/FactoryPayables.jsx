import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { WalletIcon, KeyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listFactories, getFactoryPayable } from '../api/factories';
import { createFactoryPayment, updateFactoryPayment, deleteFactoryPayment } from '../api/factoryPayments';
import { createFactoryDebit, updateFactoryDebit, deleteFactoryDebit } from '../api/factoryDebits';

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
// GET /api/factories/:id/payable, POST /api/factory-payments, and POST /api/factory-debits
// (all owner-only and PIN-gated — see LEARNING_LOG.md for why the payment POST's gate changed
// mid-task, and 05_BUSINESS_RULES.md rule 96 for why the debit endpoint exists at all).
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

  // Which of the two identical-shaped forms is open — null | 'payment' | 'debit' — rather than
  // two separate booleans. Two booleans could both be true at once with nothing to stop it,
  // silently implying two forms open simultaneously when only one set of amount/date/note/pin
  // fields actually exists below; a single enum makes "which one, if any" the only representable
  // states, the same "make the bad state unrepresentable" reasoning already applied elsewhere in
  // this codebase (e.g. Receive Stock's three-state colour loading).
  const [activeForm, setActiveForm] = useState(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInputValue);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Editing or deleting an EXISTING entry — deliberately separate state from activeForm above,
  // which stays untouched (this task's own instruction: don't touch the creation flow). null |
  // { kind: 'payment' | 'debit', mode: 'edit' | 'delete', entry }. One nullable object rather
  // than parallel edit/delete booleans, same "make the bad state unrepresentable" reasoning as
  // activeForm — an edit form and a delete confirmation are never open at the same time, any
  // more than two creation forms are.
  const [entryAction, setEntryAction] = useState(null);
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [entryPin, setEntryPin] = useState('');
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [entrySubmitError, setEntrySubmitError] = useState(null);
  const [entryAttemptsRemaining, setEntryAttemptsRemaining] = useState(null);

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
    // Any in-progress form belonged to the PREVIOUS factory's context — closing it rather than
    // silently re-pointing it at a different factory avoids recording against the wrong one.
    setActiveForm(null);
    resetForm();
    // Same reasoning applies to an in-progress edit/delete of an existing entry — it belonged
    // to a row from the previous factory's history, which is about to disappear.
    setEntryAction(null);
    setSuccessMessage(null);
  }

  function resetForm() {
    setAmount('');
    setDate(todayInputValue());
    setNote('');
    setPin('');
    setSubmitError(null);
    setAttemptsRemaining(null);
  }

  // Shared by both "Record payment" and "Record amount owed" — the two actions differ only in
  // which endpoint gets called and what the success message says; amount/date/note/pin
  // validation and PIN-failure handling are identical, matching FactoryPayment/FactoryDebit's
  // identical shape on the backend. Kept as one function branching on `activeForm` rather than
  // two near-duplicate handlers, for the same reason ScreenHeader was extracted instead of
  // copied: identical logic living in two places is a standing invitation for the two copies to
  // quietly drift (LEARNING_LOG.md).
  async function handleSubmitForm(event) {
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

    const isDebit = activeForm === 'debit';
    const submit = isDebit ? createFactoryDebit : createFactoryPayment;

    setSubmitting(true);
    try {
      await submit({
        factoryId,
        amount: parsedAmount,
        date,
        note: note.trim() || undefined,
        pin,
      });
      setSuccessMessage(
        isDebit
          ? `Amount owed of ${formatCurrency(parsedAmount)} recorded.`
          : `Payment of ${formatCurrency(parsedAmount)} recorded.`
      );
      setActiveForm(null);
      resetForm();
      // Re-fetch so the stats/history reflect the entry just made, rather than showing totals
      // that are now stale by exactly the amount just recorded.
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

  // Opens the edit form for an existing row, pre-filled with its current amount/date/note
  // (requirement 2). entry.date arrives as a full ISO timestamp ("2026-08-01T00:00:00.000Z") —
  // sliced to YYYY-MM-DD for the <input type="date">, same shape todayInputValue() produces.
  function handleStartEditEntry(kind, entry) {
    setActiveForm(null); // creation and editing an existing entry never happen at the same time
    setEntryAction({ kind, mode: 'edit', entry });
    setEntryAmount(String(entry.amount));
    setEntryDate(entry.date.slice(0, 10));
    setEntryNote(entry.note ?? '');
    setEntryPin('');
    setEntrySubmitError(null);
    setEntryAttemptsRemaining(null);
  }

  // Opens the delete confirmation for an existing row. No amount/date/note fields — there's
  // nothing to edit, just the PIN, which is itself the confirmation step (requirement 1: no
  // separate confirm-modal on top).
  function handleStartDeleteEntry(kind, entry) {
    setActiveForm(null);
    setEntryAction({ kind, mode: 'delete', entry });
    setEntryPin('');
    setEntrySubmitError(null);
    setEntryAttemptsRemaining(null);
  }

  function handleCancelEntryAction() {
    setEntryAction(null);
    setEntryPin('');
    setEntrySubmitError(null);
    setEntryAttemptsRemaining(null);
  }

  // Shared by both edit and delete of an existing entry, the same way handleSubmitForm above is
  // shared by both creation actions — one function branching on entryAction.mode rather than
  // two near-duplicate handlers.
  async function handleSubmitEntryAction(event) {
    event.preventDefault();
    setEntrySubmitError(null);
    setEntryAttemptsRemaining(null);

    const { kind, mode, entry } = entryAction;
    const parsedAmount = Number(entryAmount);

    if (mode === 'edit') {
      if (!parsedAmount || parsedAmount <= 0) {
        setEntrySubmitError('Enter a valid amount.');
        return;
      }
      if (!entryDate) {
        setEntrySubmitError('Enter a date.');
        return;
      }
    }
    if (!entryPin) {
      setEntrySubmitError('Enter your PIN.');
      return;
    }

    const isDebit = kind === 'debit';
    const update = isDebit ? updateFactoryDebit : updateFactoryPayment;
    const remove = isDebit ? deleteFactoryDebit : deleteFactoryPayment;

    setEntrySubmitting(true);
    try {
      if (mode === 'edit') {
        await update(entry.id, {
          amount: parsedAmount,
          date: entryDate,
          note: entryNote.trim() || undefined,
          pin: entryPin,
        });
        setSuccessMessage(`${isDebit ? 'Amount owed' : 'Payment'} entry updated.`);
      } else {
        await remove(entry.id, { pin: entryPin });
        setSuccessMessage(`${isDebit ? 'Amount owed' : 'Payment'} entry deleted.`);
      }
      setEntryAction(null);
      setEntryPin('');
      // Re-fetch so the stat cards and list reflect the real, current state — never patch
      // local state optimistically (requirement 4), same discipline handleSubmitForm already
      // uses after creating an entry.
      setPayableStatus('loading');
      const fresh = await getFactoryPayable(factoryId);
      setPayable(fresh);
      setPayableStatus('loaded');
    } catch (err) {
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setEntryAttemptsRemaining(err.extra.attemptsRemaining);
      }
      setEntrySubmitError(err.message);
      setEntryPin('');
    } finally {
      setEntrySubmitting(false);
    }
  }

  const showStats = factoryId && payableStatus === 'loaded' && !payableError && payable;

  // One chronological timeline instead of two separate lists to scroll through — each entry
  // tagged with its own kind so the row can render "+ Owed"/"− Paid" distinctly. Sorted by date
  // descending regardless of kind, so a debit and a payment interleave correctly by when they
  // actually happened, not grouped by type. `date` is the primary key (it's what "when this
  // happened" means to whoever's reading the list — a backdated entry belongs where its date
  // says, not at the top just because it was typed in today). When two entries share the exact
  // same date — genuinely common, e.g. several payments logged the same day — `date` alone
  // can't order them at all, so `createdAt` (when the row was actually inserted, never
  // user-edited) breaks the tie, most-recently-created first, so same-day entries still land in
  // the order they were actually recorded instead of an arbitrary array-concatenation order.
  const history = showStats
    ? [
        ...payable.payments.map((p) => ({ ...p, kind: 'payment' })),
        ...payable.debits.map((d) => ({ ...d, kind: 'debit' })),
      ].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
    : [];

  return (
    <div className="page">
      <ScreenHeader icon={<WalletIcon size={20} />} title="Factory Payables" />

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
            <h2 className="card-title">History</h2>
            {history.length === 0 ? (
              <p className="muted centered-empty-state">Nothing recorded yet.</p>
            ) : (
              history.map((entry) => {
                // Row-level edit/delete is disabled while any other form is open (creation, or
                // editing/deleting a DIFFERENT row) — not because two forms open at once would
                // break anything structurally, but because offering to start a second one while
                // one is already mid-flight invites acting on the wrong row.
                const rowActionsDisabled =
                  !!activeForm || submitting || entrySubmitting || (!!entryAction && entryAction.entry.id !== entry.id);
                return (
                  <div key={`${entry.kind}-${entry.id}`} className="payment-history-row">
                    <div className="payment-history-meta">
                      <span className="payment-history-date">
                        {formatDate(entry.date)}
                        {/* wasEdited is an explicit flag from the API, set true the moment a
                            PATCH is saved — not inferred by comparing timestamps. Replaces an
                            earlier updatedAt-vs-createdAt-plus-60-seconds heuristic that missed
                            a real edit made within a minute of creation (LEARNING_LOG.md). */}
                        {entry.wasEdited && <span className="payment-history-edited">edited</span>}
                      </span>
                      {entry.note && <span className="payment-history-note">{entry.note}</span>}
                    </div>
                    {/* entry.amount is a raw Prisma Decimal — arrives as a STRING ("250.5"), not
                        a number (see api/factories.js). formatCurrency() Number()s it internally.
                        Sign + badge + tint together distinguish the two kinds in one glance,
                        rather than requiring a second look at which list a row came from — there
                        is no second list anymore, this is the whole point of merging them. */}
                    <div className="payment-history-value">
                      <span className={`badge ${entry.kind === 'debit' ? 'badge-warning' : 'badge-success'}`}>
                        {entry.kind === 'debit' ? '+ Owed' : '− Paid'}
                      </span>
                      <span
                        className={`payment-history-amount ${
                          entry.kind === 'debit' ? 'payment-history-amount-debit' : 'payment-history-amount-payment'
                        }`}
                      >
                        {entry.kind === 'debit' ? '+' : '−'} {formatCurrency(entry.amount)}
                      </span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleStartEditEntry(entry.kind, entry)}
                        disabled={rowActionsDisabled}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-button danger-text"
                        onClick={() => handleStartDeleteEntry(entry.kind, entry)}
                        disabled={rowActionsDisabled}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {!activeForm && !user.hasPinSet && (
            <Link to="/set-pin" className="prompt-banner prompt-banner-warning">
              <KeyIcon size={18} />
              <span>Set your price-edit PIN to record a payment or amount owed.</span>
            </Link>
          )}

          {activeForm && (
            <div className="card">
              <h2 className="card-title">
                {activeForm === 'debit' ? 'Record amount owed' : 'Record payment'}
              </h2>
              {/* Lightweight inline PIN prompt, not the standard ConfirmModal (§5.8) — the PIN
                  field IS the confirmation step here, one form and one button rather than a
                  form followed by a separate overlay. Same form for both actions (only the
                  title, submit label, and which endpoint gets called differ) — see
                  handleSubmitForm. */}
              <form onSubmit={handleSubmitForm}>
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
                    placeholder={activeForm === 'debit' ? 'e.g. Pre-app opening balance' : 'e.g. Bank transfer, Cash'}
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
                  {submitting
                    ? 'Recording…'
                    : activeForm === 'debit'
                      ? 'Confirm amount owed'
                      : 'Confirm payment'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setActiveForm(null);
                    resetForm();
                  }}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {entryAction && (
            <div className="card">
              <h2 className="card-title">
                {entryAction.mode === 'delete'
                  ? `Delete ${entryAction.kind === 'debit' ? 'amount owed' : 'payment'} entry`
                  : `Edit ${entryAction.kind === 'debit' ? 'amount owed' : 'payment'} entry`}
              </h2>
              {/* Same lightweight inline PIN prompt as the creation forms above (requirement
                  1) — no separate confirm-modal on top of this one, the PIN entry IS the
                  confirmation step, for delete exactly as much as for edit. */}
              <form onSubmit={handleSubmitEntryAction}>
                {entryAction.mode === 'edit' ? (
                  <>
                    <label className="field">
                      <span className="field-label">Amount</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        value={entryAmount}
                        onChange={(e) => setEntryAmount(e.target.value)}
                        disabled={entrySubmitting}
                        required
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">Date</span>
                      <input
                        type="date"
                        value={entryDate}
                        onChange={(e) => setEntryDate(e.target.value)}
                        disabled={entrySubmitting}
                        required
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">Note (optional)</span>
                      <input
                        type="text"
                        value={entryNote}
                        onChange={(e) => setEntryNote(e.target.value)}
                        disabled={entrySubmitting}
                      />
                    </label>
                  </>
                ) : (
                  <p className="muted">
                    This permanently deletes the {formatDate(entryAction.entry.date)} entry of{' '}
                    {formatCurrency(entryAction.entry.amount)}. This cannot be undone.
                  </p>
                )}

                <label className="field">
                  <span className="field-label">Your PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={entryPin}
                    onChange={(e) => setEntryPin(e.target.value)}
                    autoComplete="off"
                    disabled={entrySubmitting}
                    required
                  />
                </label>

                {entrySubmitError && (
                  <p className="error-banner" role="alert">
                    {entrySubmitError}
                    {entryAttemptsRemaining != null &&
                      ` (${entryAttemptsRemaining} attempt${entryAttemptsRemaining === 1 ? '' : 's'} remaining)`}
                  </p>
                )}

                <button
                  type="submit"
                  className={entryAction.mode === 'delete' ? 'btn-danger' : 'btn-primary'}
                  disabled={entrySubmitting}
                >
                  {entrySubmitting
                    ? entryAction.mode === 'delete'
                      ? 'Deleting…'
                      : 'Saving…'
                    : entryAction.mode === 'delete'
                      ? 'Confirm delete'
                      : 'Save changes'}
                </button>
                <button type="button" className="btn-secondary" onClick={handleCancelEntryAction} disabled={entrySubmitting}>
                  Cancel
                </button>
              </form>
            </div>
          )}

          {!activeForm && !entryAction && (
            <div className="sticky-action-bar sticky-action-row">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setActiveForm('payment')}
                disabled={!user.hasPinSet}
              >
                Record payment
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActiveForm('debit')}
                disabled={!user.hasPinSet}
              >
                Record amount owed
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
