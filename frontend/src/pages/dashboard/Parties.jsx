import { useEffect, useRef, useState } from 'react';
import { CopyIcon, CheckCircleIcon } from '../../components/icons';
import { listParties, getPartyRevenue, getPartyPayable } from '../../api/parties';
import { createPartyPayment } from '../../api/partyPayments';
import { listOrders, updateOrderBillNo } from '../../api/orders';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE } from '../../utils/orderStatus';
import { BILL_NO_MAX_LENGTH, cleanBillNo } from '../../utils/billNo';
import { copyToClipboard } from '../../utils/clipboard';
import PinPrompt from '../../components/PinPrompt';

// Owner Dashboard — Parties (07_UI_DESIGN_BRIEF.md §8's "Parties page" section, rule 98).
// Desktop-only per rule 15 and §8's own note — no mobile/responsive version is attempted here.
//
// Scope is deliberately just what §8 documents: party browsing, contact info with a GSTIN copy
// button, a per-party sales summary, and a plain orders/bills list. Party Payables (a
// pending-amount/payment-history section) and any location-based revenue split are separate,
// explicitly out-of-scope future tasks — not partially built here.
//
// LAYOUT, 2026-08-28 (supersedes §8's original master-detail spec — updated there too), REVISED
// same day after Aadi's direct feedback on the first version: that version combined the search
// bar and the selected-party display into ONE element that switched modes on click. Aadi's
// correction — two separate, always-mounted pieces instead: PartySearchBar (a pure lookup tool,
// sits at the top) and PartyInfoBox (a constant display of the current selection, always visible,
// never itself becomes an input). Typing in the search bar only ever calls onSelect; it has no
// other effect on how the info box renders. Reasoning for the underlying "drop the party-card
// list" decision is unchanged: with only a couple of parties today the list read as mostly wasted
// space, and it doesn't scale as a browse surface once there are dozens either — a search-first
// control does the job in far less vertical space, freeing the reclaimed width for Sales
// Summary/Party Payables to use at full page width instead of a cramped right column. The old
// separate "header" (avatar+name) and "Contact" (phone/address/GSTIN) blocks are gone too, not
// just the list — both are now redundant once PartyInfoBox carries Name/Address/GSTIN/Phone
// together; keeping either would mean showing the same fields twice, right next to each other,
// for no reason.
//
// There is no GSTIN copy-to-clipboard behaviour anywhere else in the codebase (Manage Parties
// just prints the number in a plain <span>) — built fresh here, per §8's literal spec ("copies
// just the number, brief checkmark confirmation"), now living inside PartyInfoBox rather than a
// separate Contact card.
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

// Two SEPARATE, always-mounted pieces — not one control switching modes, per Aadi's own direct
// feedback on the first version of this screen (which did combine them into one element). The
// search bar is purely a lookup tool; the info box is a constant display of whichever party is
// currently selected and never itself becomes an input. Typing in the search bar filters and
// eventually calls onSelect — it never touches how the info box renders except through that.
//
// Deliberately NOT built on top of components/Combobox.jsx despite the obvious surface-level
// similarity (live-filtering text input + dropdown) — investigated first, not assumed either way.
// Combobox's own input permanently displays `option.name` as its value once something is picked,
// because Combobox IS the one place a selected value is shown. PartySearchBar's job here is
// narrower and different: it's a lookup box, not the display of the current selection (that's
// PartyInfoBox's job, a separate element) — so after a pick, it clears back to empty and ready
// for the next search, rather than parking the last result's name in it. Reuses Combobox's
// proven interaction mechanics instead of re-deriving them (outside-click closes without
// selecting, the same .combobox/.combobox-dropdown/.combobox-option CSS classes), since those
// parts really are the same problem Combobox already solved.
function PartySearchBar({ parties, selectedPartyId, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);

  // Filters by NAME ONLY, per Aadi's explicit instruction — not phone/GSTIN, even though both are
  // visible data on this same screen. Empty query shows the full list (same "browse everything"
  // capability the old list gave for free), narrowing only once something is actually typed.
  const trimmed = query.trim();
  const filteredParties = trimmed
    ? parties.filter((p) => p.name.toLowerCase().includes(trimmed.toLowerCase()))
    : parties;

  // Clears the query too, not just closes the dropdown — this box never keeps a stale result
  // sitting in it (see header comment: it's a lookup tool, not a display of the current pick).
  function closeDropdown() {
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(party) {
    onSelect(party.id);
    closeDropdown();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, filteredParties.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const party = filteredParties[highlightedIndex];
      if (party) pick(party);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  }

  return (
    <div className="field combobox dash-party-search" ref={containerRef}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => {
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search parties by name…"
        aria-label="Search parties"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && (
        <ul className="combobox-dropdown" role="listbox">
          {filteredParties.length === 0 ? (
            <li className="combobox-empty-row">
              {parties.length === 0 ? 'No parties yet.' : `No parties match "${trimmed}".`}
            </li>
          ) : (
            filteredParties.map((p, index) => (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === selectedPartyId}
                className={`combobox-option${index === highlightedIndex ? ' combobox-option-highlighted' : ''}${p.id === selectedPartyId ? ' combobox-option-selected' : ''}`}
                // onMouseDown (not onClick) + preventDefault, same reason as Combobox's own
                // dropdown rows: this fires before the input's blur, so the pick registers before
                // the outside-click handler would otherwise close the dropdown first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <div className="dash-party-option-name">{p.name}</div>
                {p.location && <div className="muted dash-party-option-location">{p.location}</div>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// The constant, always-visible display of whichever party is currently selected — a plain,
// non-interactive box, not a button and not a second copy of the search input. Labels ("Address:"
// / "GST:" / "Phone number:") are literal per Aadi's own spec; Name gets no label since it's
// self-evident as the bold, first field. justify-content: space-between (in CSS) is what actually
// spreads the fields across the full width — this component just renders them as flex children.
function PartyInfoBox({ party, copiedGstin, copyError, onCopyGstin }) {
  if (!party) {
    return <div className="dash-party-summary-line dash-party-summary-empty muted">No party selected.</div>;
  }

  return (
    <>
      <div className="dash-party-summary-line">
        <span className="dash-party-summary-name">{party.name}</span>
        {party.address && (
          <span className="dash-party-summary-field">
            <span className="dash-party-summary-field-label">Address:</span> {party.address}
          </span>
        )}
        {party.gstNo && (
          <span className="dash-party-summary-field dash-party-gstin">
            <span className="dash-party-summary-field-label">GST:</span> {party.gstNo}
            <button
              type="button"
              className="dash-party-copy-btn"
              onClick={() => onCopyGstin(party.gstNo)}
              aria-label="Copy GSTIN"
            >
              {copiedGstin ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}
            </button>
            {copiedGstin && <span className="dash-party-copied-text">Copied</span>}
          </span>
        )}
        {party.contact && (
          <span className="dash-party-summary-field">
            <span className="dash-party-summary-field-label">Phone number:</span> {party.contact}
          </span>
        )}
      </div>
      {copyError && (
        <p className="dash-party-copy-error" role="alert">
          {copyError}
        </p>
      )}
    </>
  );
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

  // --- Inline Bill No. correction on a billed order (2026-08-30). Same shape as the Factory
  // Payables screen's equivalent: the id of the row being edited, plus a draft and its own
  // saving/error state. Only ever offered on orders that have actually been billed — the server
  // rejects a bill number on anything earlier (409 ORDER_NOT_BILLED), so offering it would be
  // showing a control that cannot succeed.
  const [billNoEditId, setBillNoEditId] = useState(null);
  const [billNoDraft, setBillNoDraft] = useState('');
  const [billNoSaving, setBillNoSaving] = useState(false);
  const [billNoError, setBillNoError] = useState(null);

  function startEditBillNo(order) {
    setBillNoEditId(order.id);
    setBillNoDraft(order.billNo ?? '');
    setBillNoError(null);
  }

  function cancelEditBillNo() {
    setBillNoEditId(null);
    setBillNoDraft('');
    setBillNoError(null);
  }

  async function handleSaveBillNo(orderId) {
    setBillNoSaving(true);
    setBillNoError(null);
    try {
      const trimmed = cleanBillNo(billNoDraft);
      const updated = await updateOrderBillNo(orderId, trimmed === '' ? null : trimmed);
      // Patched in place rather than re-fetching the whole list: unlike the Factory Payables
      // screen (where the edit also has to refresh aggregate totals on the same screen), nothing
      // here is derived from billNo — no total, no count, no sort — so the one row's own new
      // value is the complete set of what changed.
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, billNo: updated.billNo } : o)));
      cancelEditBillNo();
    } catch (err) {
      setBillNoError(err.message);
    } finally {
      setBillNoSaving(false);
    }
  }

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
    // An open inline Bill No. edit belonged to a row from the previous party's order list, which
    // is about to be replaced — same reasoning as every other per-party reset here.
    cancelEditBillNo();
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
      {partiesError && (
        <p className="error-banner" role="alert">
          Could not refresh parties: {partiesError}
        </p>
      )}

      <PartySearchBar parties={sortedParties} selectedPartyId={selectedPartyId} onSelect={handleSelectParty} />

      <PartyInfoBox
        party={selectedParty}
        copiedGstin={copiedGstin}
        copyError={copyError}
        onCopyGstin={handleCopyGstin}
      />

      <div className="dash-party-detail">
        {!selectedParty ? (
          <p className="muted dash-empty">Select a party to view details.</p>
        ) : (
          <>
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
                    {/* Bill No. beside the date/status, per this feature's spec. Only for orders
                        that have actually been billed: `billedAt` is the same condition the
                        server enforces, so the control is never offered where it would 409.
                        A cancelled order is excluded too — it was never billed, and offering to
                        tag it would suggest otherwise. */}
                    {o.billedAt && !o.isCancelled && billNoEditId !== o.id && (
                      <span className="dash-party-order-billno">
                        {o.billNo && <span className="dash-party-order-billno-value">Bill No. {o.billNo}</span>}
                        <button
                          type="button"
                          className="link-button dash-party-order-billno-edit"
                          onClick={() => startEditBillNo(o)}
                          disabled={billNoSaving}
                        >
                          {o.billNo ? 'Edit' : '+ Bill no.'}
                        </button>
                      </span>
                    )}
                    {billNoEditId === o.id && (
                      <span className="dash-party-order-billno-form">
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
                          onClick={() => handleSaveBillNo(o.id)}
                          disabled={billNoSaving}
                        >
                          {billNoSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="link-button" onClick={cancelEditBillNo} disabled={billNoSaving}>
                          Cancel
                        </button>
                        {billNoError && (
                          <span className="dash-party-order-billno-error" role="alert">
                            {billNoError}
                          </span>
                        )}
                      </span>
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
