import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { WalletIcon, KeyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listFactories, getFactoryPayable } from '../api/factories';
import { createFactoryPayment, updateFactoryPayment, deleteFactoryPayment } from '../api/factoryPayments';
import {
  createFactoryDebit,
  updateFactoryDebit,
  updateFactoryDebitBillNo,
  deleteFactoryDebit,
} from '../api/factoryDebits';
import { BILL_NO_MAX_LENGTH, cleanBillNo } from '../utils/billNo';

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
// `inDashboard` selects which shell wraps the content — see the return at the bottom of this
// function. One component serves both the mobile screen (/factory-payables) and the Owner
// Dashboard page (/dashboard/factory-payables) rather than a separate dashboard copy, because
// every line of behaviour here (the payable calculation, the per-request PIN on every write, the
// edit/delete flows) is identical on both and a second copy would be two places to fix each bug.
// Defaults to false so the existing mobile route keeps working untouched.
export default function FactoryPayables({ inDashboard = false }) {
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
  // Optional reference tag, DEBIT FORM ONLY (2026-08-30) — never rendered or sent for a payment.
  // A payment is not tied to exactly one bill (two or three bills routinely get settled with a
  // single lump sum), so a bill number on a payment row would be actively misleading, not merely
  // unused. Kept as one piece of state despite the shared form below, because the shared form
  // simply doesn't render this field in payment mode.
  const [billNo, setBillNo] = useState('');
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

  // --- Inline Bill No. correction (2026-08-30), deliberately its OWN small state rather than a
  // field inside entryAction's edit form above. Two reasons: that form is PIN-gated because every
  // field on it is financial, and a reference-tag typo shouldn't demand a PIN (the endpoint it
  // calls provably can't change an amount); and this is a one-field inline edit rather than a
  // full form, so folding it in would mean the edit form rendering differently per row type.
  // Holds the id of the debit whose tag is currently being edited, or null.
  const [billNoEditId, setBillNoEditId] = useState(null);
  const [billNoDraft, setBillNoDraft] = useState('');
  const [billNoSaving, setBillNoSaving] = useState(false);
  const [billNoError, setBillNoError] = useState(null);

  function startEditBillNo(entry) {
    setBillNoEditId(entry.id);
    setBillNoDraft(entry.billNo ?? '');
    setBillNoError(null);
  }

  function cancelEditBillNo() {
    setBillNoEditId(null);
    setBillNoDraft('');
    setBillNoError(null);
  }

  async function handleSaveBillNo(entryId) {
    setBillNoSaving(true);
    setBillNoError(null);
    try {
      const trimmed = cleanBillNo(billNoDraft);
      // Empty means "clear it" — sent as an explicit null rather than omitted, so the server can
      // tell a deliberate blanking apart from a field that simply wasn't provided.
      await updateFactoryDebitBillNo(entryId, trimmed === '' ? null : trimmed);
      // Re-fetch rather than patching the row locally: the same reasoning the create/edit flows
      // above already use — one source of truth for what's on screen, no hand-maintained copy
      // that could disagree with the server.
      const fresh = await getFactoryPayable(factoryId);
      setPayable(fresh);
      cancelEditBillNo();
    } catch (err) {
      setBillNoError(err.message);
    } finally {
      setBillNoSaving(false);
    }
  }

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
    // Same reasoning again for an open inline Bill No. edit — its row is about to disappear.
    cancelEditBillNo();
    setSuccessMessage(null);
  }

  function resetForm() {
    setAmount('');
    setDate(todayInputValue());
    setNote('');
    setBillNo('');
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
        // Debit only, and only when actually filled in — createFactoryPayment's endpoint has no
        // billNo column at all, so it must never even be sent there.
        ...(isDebit && billNo.trim() ? { billNo: billNo.trim() } : {}),
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

  // The screen's actual content, identical in both shells — deliberately built once as a fragment
  // rather than duplicated, so the mobile screen and the dashboard page can never drift apart.
  const content = (
    <>
      {factoriesError && (
        <p className="error-banner" role="alert">
          Could not load factories: {factoriesError}
        </p>
      )}

      {/* factory-field-tight: page-scoped modifier (index.css) applied alongside the shared
          .field, not in place of it — narrows just this field's margin-bottom for this screen
          instead of touching .field's own base rule, which 17+ other forms also rely on. */}
      <label className="field factory-field-tight">
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
          {/* factory-stat-row-tight / factory-stat-hero-tight: page-scoped modifiers (index.css),
              applied alongside the shared .stat-row/.stat-hero rather than editing those directly —
              .stat-row and .stat-hero are also used by LiveStock.jsx, dashboard/LiveStock.jsx and
              dashboard/Parties.jsx, which should keep their normal spacing. */}
          <div className="stat-row factory-stat-row-tight">
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(payable.totalOwed)}</span>
              <span className="stat-label">Total owed</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{formatCurrency(payable.totalPaid)}</span>
              <span className="stat-label">Total paid</span>
            </div>
          </div>

          <div className="stat-hero factory-stat-hero-tight">
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
                        {/* Bill No. sits right next to the date, per this feature's own spec —
                            the two together are how an owner locates a specific entry against
                            paperwork. Debits only: a payment row has no billNo field at all.
                            Note there is deliberately no "edited" marker for a billNo change —
                            see updateFactoryDebitBillNo's comment on why wasEdited stays scoped
                            to amount corrections. */}
                        {entry.kind === 'debit' && billNoEditId !== entry.id && entry.billNo && (
                          <span className="payment-history-billno">Bill No. {entry.billNo}</span>
                        )}
                        {entry.kind === 'debit' && billNoEditId !== entry.id && (
                          <button
                            type="button"
                            className="link-button payment-history-billno-edit"
                            onClick={() => startEditBillNo(entry)}
                            disabled={rowActionsDisabled || billNoSaving}
                          >
                            {entry.billNo ? 'Edit bill no.' : '+ Bill no.'}
                          </button>
                        )}
                      </span>
                      {entry.kind === 'debit' && billNoEditId === entry.id && (
                        <span className="payment-history-billno-form">
                          <input
                            type="text"
                            value={billNoDraft}
                            onChange={(e) => setBillNoDraft(e.target.value)}
                            placeholder="e.g. INV-2291"
                            aria-label="Bill No."
                            maxLength={BILL_NO_MAX_LENGTH}
                            disabled={billNoSaving}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleSaveBillNo(entry.id)}
                            disabled={billNoSaving}
                          >
                            {billNoSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            onClick={cancelEditBillNo}
                            disabled={billNoSaving}
                          >
                            Cancel
                          </button>
                          {billNoError && (
                            <span className="payment-history-billno-error" role="alert">
                              {billNoError}
                            </span>
                          )}
                        </span>
                      )}
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

                {/* Debit only — see the billNo state's own comment for why a payment never gets
                    one. Rendered above Note because it identifies WHICH bill this is, which reads
                    more naturally before free-text elaboration about it. */}
                {activeForm === 'debit' && (
                  <label className="field">
                    <span className="field-label">Bill No. (optional)</span>
                    <input
                      type="text"
                      value={billNo}
                      onChange={(e) => setBillNo(e.target.value)}
                      placeholder="e.g. INV-2291"
                      maxLength={BILL_NO_MAX_LENGTH}
                      disabled={submitting}
                    />
                  </label>
                )}

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
    </>
  );

  // Inside the Owner Dashboard the shell (DashboardLayout) already supplies the page chrome this
  // screen would otherwise draw for itself: the title, the breadcrumb, and the surrounding
  // padding. Rendering `.page` + ScreenHeader in there too would produce a second, competing
  // header, and — worse — ScreenHeader's back arrow points at "/", which would silently eject the
  // owner out of the dashboard entirely. So the dashboard gets the bare content and lets the
  // shell frame it, exactly as every other dashboard page does.
  //
  // Only the OUTER WRAPPER differs. Nothing inside `content` is branched on shell, because
  // everything in it (.stat-row, .stat-hero, .card, .payment-history-row, .sticky-action-bar) is
  // shared app-wide vocabulary that already sizes off its container rather than a fixed width —
  // the deliberately narrow 480px column is `.page`'s doing, not the content's.
  if (inDashboard) return content;

  return (
    <div className="page">
      <ScreenHeader icon={<WalletIcon size={20} />} title="Factory Payables" />
      {content}
    </div>
  );
}
