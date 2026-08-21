import { useEffect, useState } from 'react';
import { CopyIcon, CheckCircleIcon } from '../../components/icons';
import { listParties, getPartyRevenue, getPartyPayable } from '../../api/parties';
import { createPartyPayment } from '../../api/partyPayments';
import { listOrders } from '../../api/orders';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE } from '../../utils/orderStatus';
import { copyToClipboard } from '../../utils/clipboard';
import PinPrompt from '../../components/PinPrompt';

// Owner Dashboard — Parties (07_UI_DESIGN_BRIEF.md §8's "Parties page" section, rule 98).
// Desktop-only per rule 15 and §8's own note — no mobile/responsive version is attempted here.
//
// Scope is deliberately just what §8 documents: master-detail party browsing, contact info with
// a GSTIN copy button, a per-party sales summary, and a plain orders/bills list. Party Payables
// (a pending-amount/payment-history section) and any location-based revenue split are separate,
// explicitly out-of-scope future tasks — not partially built here.
//
// Two things the task's own brief pointed at as "existing patterns to reuse" turned out not to
// exist anywhere in the codebase yet: there is no "party card" component (Manage Parties uses a
// flat accordion-row list, not cards — .party-option-row in New Order's picker isn't a card
// either), and there is no GSTIN copy-to-clipboard behaviour anywhere (Manage Parties just prints
// the number in a plain <span>). Both are built fresh here, directly off §8's own literal spec
// ("rectangular cards, name + location" / "copies just the number, brief checkmark
// confirmation") rather than off a precedent that isn't actually there.
//
// The sales summary calls the real shared calculation (utils/revenue.js's computeRevenue, via
// the new GET /api/parties/:id/revenue) — no revenue math of any kind lives in this file. "Last
// 6 months" and the custom From/To range were both added to revenue.js itself (not here), per
// rule 98's "one calculation path" requirement — this page just supplies a period name or a
// from/to month pair, same as the Overview KPI supplies a period name.
//
// Party Payables (added 2026-08-21) — the mirror of Factory Payables, reverse direction. Same
// "no revenue/profit math in this file" rule: amountDue = totalBilled − totalPaid − totalReturned
// is computed entirely server-side (GET /api/parties/:id/payable), this page only renders it.
//
// "Record payment" is a two-step reveal rather than one combined form: amount/date/note first,
// then PinPrompt for the actual PIN + submit. This is what lets PinPrompt be reused completely
// unmodified — it's a real <form> of its own (just the PIN field + button), so it can't be
// nested inside a second <form> the way the three older inline PIN prompts (ArticlePricing,
// FactoryPayables) put the PIN field alongside other required inputs in ONE form. Staging the
// other fields first, then swapping to PinPrompt only once they're valid, sidesteps that
// entirely rather than fighting it.

const PERIOD_CHIPS = [
  { value: 'month', label: 'This month' },
  { value: 'six_months', label: 'Last 6 months' },
  { value: 'fy', label: 'This FY' },
  { value: 'all', label: 'All time' },
];

function inr(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Same tiny helper DashboardLayout.jsx already has for the owner's own rail avatar — duplicated
// rather than extracted for a two-line pure function used in exactly two places.
// Local calendar date, NOT toISOString().slice(0, 10) — that reads UTC, which is silently the
// wrong day for a chunk of every IST day (this app's real timezone): e.g. 00:44 IST on 21 Aug is
// still 19:14 UTC on 20 Aug, so an ISO-string default would pre-fill the Record Payment date
// picker with yesterday. Caught by testing this exact form for real, not spotted by inspection —
// see LEARNING_LOG.md. getFullYear/getMonth/getDate all read local time, matching what
// <input type="date"> shows and what a user actually means by "today."
function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function Parties() {
  const [parties, setParties] = useState([]);
  const [partiesStatus, setPartiesStatus] = useState('idle');
  const [partiesError, setPartiesError] = useState(null);

  const [selectedPartyId, setSelectedPartyId] = useState(null);

  const [revenuePeriod, setRevenuePeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState(''); // 'YYYY-MM' from <input type="month">
  const [customTo, setCustomTo] = useState('');
  const [revenue, setRevenue] = useState(null);
  const [revenueStatus, setRevenueStatus] = useState('idle');
  const [revenueError, setRevenueError] = useState(null);

  const [orders, setOrders] = useState([]);
  const [ordersStatus, setOrdersStatus] = useState('idle');
  const [ordersError, setOrdersError] = useState(null);

  const [copiedGstin, setCopiedGstin] = useState(false);
  const [copyError, setCopyError] = useState(null);

  const [payable, setPayable] = useState(null);
  const [payableStatus, setPayableStatus] = useState('idle');
  const [payableError, setPayableError] = useState(null);

  // Record Payment is now a three-state reveal, not two: collapsed (just a button) -> step 1
  // (amount/date/note) -> step 2 (PinPrompt). paymentFormOpen is the new outer gate; paymentDraft
  // (below) still distinguishes step 1 from step 2 exactly as before, so it's read as
  // "!paymentFormOpen -> collapsed, paymentFormOpen && !paymentDraft -> step 1, paymentFormOpen
  // && paymentDraft -> step 2" rather than two independent booleans that could disagree.
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => todayIso());
  const [paymentNote, setPaymentNote] = useState('');
  // Staged { amount, date, note } once the amount/date/note step is confirmed valid — its
  // presence is what switches the form over to PinPrompt. null means still on the details step.
  const [paymentDraft, setPaymentDraft] = useState(null);
  const [paymentFormError, setPaymentFormError] = useState(null);
  const [paymentSuccess, setPaymentSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPartiesStatus('loading');
    listParties()
      .then((list) => {
        if (!cancelled) setParties(list);
      })
      .catch((err) => {
        if (!cancelled) setPartiesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPartiesStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sales summary — refetches on every period/party/custom-range change, same "recomputed fresh,
  // never cached across a change" rule Overview's own Revenue selector follows.
  useEffect(() => {
    if (!selectedPartyId) return;
    if (revenuePeriod === 'custom' && (!customFrom || !customTo)) return; // incomplete range, nothing to fetch yet
    let cancelled = false;
    setRevenueStatus('loading');
    setRevenueError(null);
    const params =
      revenuePeriod === 'custom' ? { period: 'custom', from: customFrom, to: customTo } : { period: revenuePeriod };
    getPartyRevenue(selectedPartyId, params)
      .then((data) => {
        if (!cancelled) setRevenue(data);
      })
      .catch((err) => {
        if (!cancelled) setRevenueError(err.message);
      })
      .finally(() => {
        if (!cancelled) setRevenueStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPartyId, revenuePeriod, customFrom, customTo]);

  // Party Payables — only depends on which party is selected. Extracted as a named function
  // (not just inlined in the effect) so the "record payment" success handler can call the exact
  // same reload rather than duplicating the fetch.
  function loadPayable(partyId) {
    setPayableStatus('loading');
    setPayableError(null);
    return getPartyPayable(partyId)
      .then((data) => setPayable(data))
      .catch((err) => setPayableError(err.message))
      .finally(() => setPayableStatus('loaded'));
  }

  useEffect(() => {
    if (!selectedPartyId) return;
    loadPayable(selectedPartyId);
  }, [selectedPartyId]);

  // Orders and bills — only depends on which party is selected, not on the revenue period.
  useEffect(() => {
    if (!selectedPartyId) return;
    let cancelled = false;
    setOrdersStatus('loading');
    setOrdersError(null);
    listOrders({ partyId: selectedPartyId })
      .then((list) => {
        if (!cancelled) setOrders(list);
      })
      .catch((err) => {
        if (!cancelled) setOrdersError(err.message);
      })
      .finally(() => {
        if (!cancelled) setOrdersStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPartyId]);

  function handleSelectParty(id) {
    setSelectedPartyId(id);
    setRevenuePeriod('month');
    setCustomFrom('');
    setCustomTo('');
    setCopiedGstin(false);
    setCopyError(null);
    setPaymentFormOpen(false);
    setPaymentAmount('');
    setPaymentDate(todayIso());
    setPaymentNote('');
    setPaymentDraft(null);
    setPaymentFormError(null);
    setPaymentSuccess(null);
  }

  function handleCustomFromChange(e) {
    setCustomFrom(e.target.value);
    setRevenuePeriod('custom');
  }

  function handleCustomToChange(e) {
    setCustomTo(e.target.value);
    setRevenuePeriod('custom');
  }

  // Step 1 of Record Payment: validate amount/date, then stage them — this is what reveals
  // PinPrompt (see the header comment on why this is two steps, not one combined form).
  function handleContinueToPin(event) {
    event.preventDefault();
    setPaymentFormError(null);
    const amountNum = Number(paymentAmount);
    if (!paymentAmount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setPaymentFormError('Enter a valid amount greater than 0.');
      return;
    }
    if (!paymentDate) {
      setPaymentFormError('Pick a date.');
      return;
    }
    setPaymentDraft({ amount: amountNum, date: paymentDate, note: paymentNote.trim() || undefined });
  }

  // Step 1 -> collapsed: an explicit way back out, so opening the form isn't a one-way trip.
  // Clears the same fields handleSelectParty resets, so a cancelled attempt never leaves stale
  // values behind for the next time this party's form is opened.
  function handleCancelPayment() {
    setPaymentFormOpen(false);
    setPaymentAmount('');
    setPaymentDate(todayIso());
    setPaymentNote('');
    setPaymentFormError(null);
  }

  // Step 2: PinPrompt calls this with just the pin — throws on failure, which PinPrompt's own
  // error/lockout handling catches (see that component for why nothing is duplicated here).
  async function handleConfirmPayment(pin) {
    const created = await createPartyPayment({ partyId: selectedPartyId, ...paymentDraft, pin });
    setPaymentFormOpen(false); // back to collapsed, not step 1 — see header comment
    setPaymentAmount('');
    setPaymentDate(todayIso());
    setPaymentNote('');
    setPaymentDraft(null);
    setPaymentSuccess(`Payment of ${inr(created.amount)} recorded.`);
    setTimeout(() => setPaymentSuccess(null), 3000);
    // Refetch so amountDue/totalPaid/the payment list all reflect the new entry — the same
    // "trust a fresh server computation over local arithmetic" rule the Locations page's
    // profit-share save already established.
    await loadPayable(selectedPartyId);
  }

  async function handleCopyGstin(value) {
    setCopyError(null);
    // navigator.clipboard.writeText silently doesn't exist over the plain-HTTP LAN URL this app
    // actually runs under day to day (no secure context) — copyToClipboard falls back to
    // document.execCommand('copy') there and reports real success/failure instead of throwing.
    const succeeded = await copyToClipboard(value);
    if (succeeded) {
      setCopiedGstin(true);
      setTimeout(() => setCopiedGstin(false), 1500);
    } else {
      setCopyError('Could not copy — select and copy the GSTIN manually.');
    }
  }

  const activeParties = parties.filter((p) => p.isActive);
  const sortedParties = [...activeParties].sort((a, b) => a.name.localeCompare(b.name));
  const selectedParty = parties.find((p) => p.id === selectedPartyId) ?? null;

  if (partiesStatus !== 'loaded') {
    return (
      <>
        {partiesError && (
          <p className="error-banner" role="alert">
            Could not load parties: {partiesError}
          </p>
        )}
        {!partiesError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <div className="dash-parties-layout">
      <div className="dash-parties-list">
        {partiesError && (
          <p className="error-banner" role="alert">
            Could not refresh parties: {partiesError}
          </p>
        )}
        {sortedParties.length === 0 ? (
          <p className="muted dash-empty">No parties yet.</p>
        ) : (
          sortedParties.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`dash-party-card${p.id === selectedPartyId ? ' dash-party-card-selected' : ''}`}
              onClick={() => handleSelectParty(p.id)}
            >
              <div className="dash-party-card-name">{p.name}</div>
              {p.location && <div className="muted dash-party-card-location">{p.location}</div>}
            </button>
          ))
        )}
      </div>

      <div className="dash-party-detail">
        {!selectedParty ? (
          <p className="muted dash-empty">Select a party to view details.</p>
        ) : (
          <>
            <div className="dash-card dash-party-header">
              <div className="dash-party-avatar">{initialsOf(selectedParty.name)}</div>
              <div>
                <div className="dash-party-name">{selectedParty.name}</div>
                {selectedParty.location && <div className="muted">{selectedParty.location}</div>}
              </div>
            </div>

            <div className="dash-card">
              {selectedParty.contact && (
                <div className="party-detail-row">
                  <span className="party-detail-label">Phone</span>
                  <span>{selectedParty.contact}</span>
                </div>
              )}
              {selectedParty.address && (
                <div className="party-detail-row">
                  <span className="party-detail-label">Address</span>
                  <span>{selectedParty.address}</span>
                </div>
              )}
              {selectedParty.gstNo && (
                <div className="party-detail-row">
                  <span className="party-detail-label">GSTIN</span>
                  <span className="dash-party-gstin">
                    {selectedParty.gstNo}
                    <button
                      type="button"
                      className="dash-party-copy-btn"
                      onClick={() => handleCopyGstin(selectedParty.gstNo)}
                      aria-label="Copy GSTIN"
                    >
                      {copiedGstin ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}
                    </button>
                    {copiedGstin && <span className="dash-party-copied-text">Copied</span>}
                  </span>
                  {copyError && (
                    <span className="dash-party-copy-error" role="alert">
                      {copyError}
                    </span>
                  )}
                </div>
              )}
              {!selectedParty.contact && !selectedParty.address && !selectedParty.gstNo && (
                <p className="muted">No additional details on file.</p>
              )}
            </div>

            <div className="dash-card dash-party-summary">
              <h2 className="dash-section-title">Sales summary</h2>
              <div className="dash-party-chip-row">
                {PERIOD_CHIPS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`chip${revenuePeriod === c.value ? ' chip-selected' : ''}`}
                    onClick={() => setRevenuePeriod(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="dash-party-month-range">
                <label className="field dash-party-month-field">
                  <span className="field-label">From</span>
                  <input type="month" value={customFrom} onChange={handleCustomFromChange} />
                </label>
                <label className="field dash-party-month-field">
                  <span className="field-label">To</span>
                  <input type="month" value={customTo} onChange={handleCustomToChange} />
                </label>
              </div>

              {revenuePeriod === 'custom' && (!customFrom || !customTo) ? (
                <p className="muted dash-empty">Pick both a From and To month.</p>
              ) : revenueError ? (
                <p className="error-banner" role="alert">
                  Could not load revenue: {revenueError}
                </p>
              ) : revenueStatus !== 'loaded' || !revenue ? (
                <p className="muted dash-empty">Loading…</p>
              ) : (
                <>
                  <div className="dash-party-summary-value">{inr(revenue.revenue)}</div>
                  <div className="muted dash-party-summary-label">{revenue.label}</div>
                </>
              )}
            </div>

            <div className="dash-card">
              <h2 className="dash-section-title">Party Payables</h2>
              {payableError ? (
                <p className="error-banner" role="alert">
                  Could not load payables: {payableError}
                </p>
              ) : payableStatus !== 'loaded' || !payable ? (
                <p className="muted dash-empty">Loading…</p>
              ) : (
                <>
                  <div className="stat-row">
                    <div className="stat-card">
                      <span className="stat-value">{inr(payable.totalBilled)}</span>
                      <span className="stat-label">Total billed</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-value">{inr(payable.totalPaid)}</span>
                      <span className="stat-label">Total paid</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-value">{inr(payable.totalReturned)}</span>
                      <span className="stat-label">Total returned</span>
                    </div>
                  </div>

                  <div className="stat-hero">
                    <span className="stat-hero-value">{inr(payable.amountDue)}</span>
                    <span className="stat-hero-label">Amount due</span>
                  </div>

                  {payable.payments.length === 0 ? (
                    <p className="muted dash-empty">No payments recorded yet.</p>
                  ) : (
                    payable.payments.map((p) => (
                      <div key={p.id} className="dash-party-payment-row">
                        <div className="dash-party-payment-main">
                          <span className="dash-party-payment-date">{formatDate(p.date)}</span>
                          {p.wasEdited && <span className="badge badge-warning">Edited</span>}
                        </div>
                        {p.note && <span className="muted dash-party-payment-note">{p.note}</span>}
                        <span className="dash-party-payment-value">{inr(p.amount)}</span>
                      </div>
                    ))
                  )}

                  <div className="dash-party-record-payment">
                    <h3 className="dash-party-record-payment-title">Record payment</h3>
                    {paymentSuccess && <p className="dash-party-payment-success">{paymentSuccess}</p>}
                    {!paymentFormOpen ? (
                      <button type="button" className="btn-primary" onClick={() => setPaymentFormOpen(true)}>
                        Record payment
                      </button>
                    ) : !paymentDraft ? (
                      <form onSubmit={handleContinueToPin}>
                        <label className="field">
                          <span className="field-label">Amount</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            step="0.01"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            required
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Date</span>
                          <input
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            required
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Note (optional)</span>
                          <input type="text" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
                        </label>
                        {paymentFormError && (
                          <p className="error-banner" role="alert">
                            {paymentFormError}
                          </p>
                        )}
                        <button type="submit" className="btn-primary">
                          Continue
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleCancelPayment}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div>
                        <p className="muted">
                          Recording {inr(paymentDraft.amount)} on {formatDate(paymentDraft.date)}
                          {paymentDraft.note ? ` — "${paymentDraft.note}"` : ''}. Enter your PIN to confirm.
                        </p>
                        <PinPrompt
                          submitLabel="Record payment"
                          submittingLabel="Recording…"
                          autoFocus
                          onSubmit={handleConfirmPayment}
                        />
                        <button type="button" className="link-button" onClick={() => setPaymentDraft(null)}>
                          Change details
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="dash-card">
              <h2 className="dash-section-title">Orders and bills</h2>
              {ordersError ? (
                <p className="error-banner" role="alert">
                  Could not load orders: {ordersError}
                </p>
              ) : ordersStatus !== 'loaded' ? (
                <p className="muted dash-empty">Loading…</p>
              ) : orders.length === 0 ? (
                <p className="muted dash-empty">No orders yet.</p>
              ) : (
                orders.map((o) => (
                  <div key={o.id} className={`dash-party-order-row${o.isCancelled ? ' dash-party-order-row-cancelled' : ''}`}>
                    <span className="dash-party-order-date">{formatDate(o.createdAt)}</span>
                    {o.isCancelled ? (
                      <span className="badge badge-danger">Cancelled</span>
                    ) : (
                      <span className={`badge ${ORDER_STATUS_BADGE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                    )}
                    <span className="dash-party-order-value">{inr(o.totalValue)}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
