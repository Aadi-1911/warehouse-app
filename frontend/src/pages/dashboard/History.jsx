import { useEffect, useState } from 'react';
import { listHistory } from '../../api/history';
import { actorBadgeColorFor } from '../../utils/avatar';
import { listLocations } from '../../api/locations';
import { listFactories } from '../../api/factories';
import { listProducts, getValidColors } from '../../api/products';
import { createTransactionCorrection } from '../../api/transactionCorrections';
import { createTransferCorrection } from '../../api/transferCorrections';
import PinPrompt from '../../components/PinPrompt';

// Owner Dashboard — History (07_UI_DESIGN_BRIEF.md §8's "History page" section, rules 58 and 70).
//
// Same feed, same day-grouping, same per-type tag colours as the staff-facing History.jsx —
// deliberately not re-derived here. This page borrows that screen's grouping logic and CSS
// classes (.history-day / .history-row / etc, already generic — no mobile-only assumptions) so
// the two surfaces can't quietly drift apart on what a day boundary or a tag colour means. GET
// /api/history is unfiltered and already returns every entry with no pagination (04_API_SPEC.md),
// so this page adds no query params — it renders the full feed, whereas Overview's own activity
// widget deliberately only shows a recent slice.
//
// Transfer Corrections (added 2026-08-21, same day as Transaction Corrections) — the deferred
// follow-up. Same principle (never edit in place, atomic reversal + reapplication), no PIN branch
// at all this time: a Transfer never touches price (costPriceSnapshot is null on both legs by
// design), so there's nothing conditional to build here, unlike the receipt form below. Bundle/
// article isn't correctable either — a Transfer's own scope is quantity/from-location/to-location
// only, so this form has no article-search sub-flow.
//
// Transaction Corrections (added 2026-08-21) — rule 70 REVERSED, not extended. Rule 70 originally
// read "Owner's view of History is read-only — no correction affordance on the owner surface,
// even though staff's History screen has one." That was written when staff's screen had no
// correction UI either (verified directly — nothing existed anywhere at the time), so it was
// forward-looking policy, not a description of a shipped feature being protected. When this
// feature was actually built, the decision was to put it here instead: a Receive Stock receipt
// correction is OWNER-only (matches "creating the original entry," which staff can already do
// PIN-free), with a PIN required only when the correction touches cost price — the same
// unconditional rule 71 already applies to every other costPrice edit in this app, correction or
// not. Rule 70 has been updated in 05_BUSINESS_RULES.md to record this as a deliberate reversal,
// not left silently contradicting what actually shipped. Staff's History.jsx still renders these
// same RECEIPT/RECEIPT_CORRECTION entries (GET /api/history has no role branching, never did) —
// it just never renders a Correct button, because this file is the only one that does.
//
// The correction form never touches costPriceSnapshot's actual number in its OWN display beyond
// the input the owner types into — same "never let a number the history feed itself withholds
// leak back in through a different door" discipline historyController.js's own header comment
// already states for the read side.

const TYPE_BADGE_CLASSES = {
  ORDER_PLACED: 'badge-purple',
  ORDER_STATUS: 'badge-success',
  ORDER_ADJUSTMENT: 'badge-warning',
  TRANSFER: 'badge-accent',
  GOOD_RETURN: 'badge-warning',
  RECEIPT: 'badge-accent', // stock movement, same colour role as TRANSFER
  RECEIPT_CORRECTION: 'badge-warning', // a correction, same colour role as ORDER_ADJUSTMENT/GOOD_RETURN
  TRANSFER_CORRECTION: 'badge-warning',
};

const FALLBACK_BADGE_CLASS = 'badge-accent';
const FALLBACK_LABEL = 'Event';

const CORRECTION_REASONS = [
  { value: 'WRONG_QUANTITY', label: 'Wrong quantity' },
  { value: 'WRONG_LOCATION', label: 'Wrong location' },
  { value: 'WRONG_FACTORY', label: 'Wrong factory' },
  { value: 'WRONG_PRICE', label: 'Wrong price' },
  { value: 'OTHER', label: 'Other' },
];

const TRANSFER_CORRECTION_REASONS = [
  { value: 'WRONG_QUANTITY', label: 'Wrong quantity' },
  { value: 'WRONG_FROM_LOCATION', label: 'Wrong from-location' },
  { value: 'WRONG_TO_LOCATION', label: 'Wrong to-location' },
  { value: 'OTHER', label: 'Other' },
];

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function formatDayHeading(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function History() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Locations/Factories for the correction form's own pickers — fetched once, not per correction.
  const [locations, setLocations] = useState([]);
  const [factories, setFactories] = useState([]);

  // --- Correction: which RECEIPT entry (by transactionId) currently has its form open. Collapsed
  // by default (null) for every entry, same "button first, form only on request" pattern the
  // Parties page's own Record Payment already established — a correction is a rarer, heavier
  // action than the routine rows around it, so it shouldn't be permanently visible per row.
  const [correctingId, setCorrectingId] = useState(null);
  const [qtySets, setQtySets] = useState('');
  const [locationId, setLocationId] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [articleDisplay, setArticleDisplay] = useState('');
  const [changingArticle, setChangingArticle] = useState(false);
  const [touchPrice, setTouchPrice] = useState(false);
  const [costPrice, setCostPrice] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState(null);
  // Staged payload once "Continue" is confirmed valid — non-null is what reveals step 2 (either
  // PinPrompt, when the correction touches price, or a plain confirm button when it doesn't).
  const [draft, setDraft] = useState(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [correctionSuccess, setCorrectionSuccess] = useState(null);

  // --- Article search sub-state, only used while changingArticle is true. Same cross-factory
  // search plus rule 54 disambiguation chips as Good Returns/New Order — article numbers are only
  // unique per Factory, never globally.
  const [articleNoInput, setArticleNoInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState(null);
  const [resolvedProduct, setResolvedProduct] = useState(null);
  const [colors, setColors] = useState([]);
  const [colorsStatus, setColorsStatus] = useState('idle');
  const [colorsError, setColorsError] = useState(null);

  // --- Transfer correction: same "collapsed by default, one open at a time" shape as the receipt
  // correction above, kept as its own parallel state rather than unified with it — the two forms
  // genuinely differ (no price/PIN branch, no article search, two locations instead of one), and
  // OrderAdjustmentReason/GoodReturnReason already established this codebase's convention of
  // keeping superficially-similar-but-distinct reason flows separate rather than forcing one
  // shared shape.
  const [correctingTransferId, setCorrectingTransferId] = useState(null);
  const [transferQtySets, setTransferQtySets] = useState('');
  const [transferFromLocationId, setTransferFromLocationId] = useState('');
  const [transferToLocationId, setTransferToLocationId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferFormError, setTransferFormError] = useState(null);
  const [transferDraft, setTransferDraft] = useState(null);
  const [transferConfirmSubmitting, setTransferConfirmSubmitting] = useState(false);

  function loadHistory() {
    setStatus('loading');
    setError(null);
    return listHistory()
      .then((list) => setEntries(list))
      .catch((err) => setError(err.message))
      .finally(() => setStatus('loaded'));
  }

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listLocations(), listFactories()])
      .then(([locs, facs]) => {
        if (cancelled) return;
        setLocations(locs);
        setFactories(facs);
      })
      .catch(() => {
        // Non-fatal: the feed itself already loaded via the effect above. Leaving these empty
        // just means the correction form's pickers show nothing until a retry (opening the
        // Correct form) succeeds — no error banner competing with the main feed's own.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function factoryName(factoryId) {
    return factories.find((f) => f.id === factoryId)?.name ?? 'Unknown Factory';
  }

  function resetArticleSearch() {
    setArticleNoInput('');
    setSearching(false);
    setSearchError(null);
    setDisambiguationOptions(null);
    setResolvedProduct(null);
    setColors([]);
    setColorsStatus('idle');
    setColorsError(null);
  }

  async function handleSearchArticle() {
    setSearchError(null);
    setDisambiguationOptions(null);
    const trimmed = articleNoInput.trim();
    if (!trimmed) {
      setSearchError('Enter an article number.');
      return;
    }
    setSearching(true);
    try {
      const results = await listProducts({ articleNo: trimmed });
      const exact = results.filter((p) => p.articleNo.toLowerCase() === trimmed.toLowerCase() && p.isActive);
      if (exact.length === 0) {
        setSearchError(`No active article found with number "${trimmed}".`);
      } else if (exact.length === 1) {
        setResolvedProduct(exact[0]);
      } else {
        setDisambiguationOptions(exact);
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!resolvedProduct) {
      setColorsStatus('idle');
      return;
    }
    let cancelled = false;
    setColorsStatus('loading');
    setColorsError(null);
    getValidColors(resolvedProduct.id)
      .then((list) => {
        if (!cancelled) setColors(list);
      })
      .catch((err) => {
        if (!cancelled) setColorsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setColorsStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedProduct]);

  function handlePickColor(c) {
    setBundleId(c.bundleId);
    setArticleDisplay(`${resolvedProduct.articleNo} — ${c.name}`);
    setChangingArticle(false);
  }

  function handleStartCorrect(entry) {
    setCorrectingId(entry.transactionId);
    setQtySets(String(entry.qtySets));
    setLocationId(entry.locationId);
    setBundleId(entry.bundleId);
    setArticleDisplay(`${entry.articleNo} — ${entry.colorName}`);
    setChangingArticle(false);
    resetArticleSearch();
    setTouchPrice(false);
    setCostPrice('');
    setReason('');
    setNote('');
    setFormError(null);
    setDraft(null);
  }

  function handleCancelCorrect() {
    setCorrectingId(null);
    setDraft(null);
    setFormError(null);
  }

  // Step 1: validate and stage. Step 2 is either PinPrompt (touchPrice) or a plain confirm button
  // (not) — the fields are identical either way, only the final control differs, same two-step
  // reveal shape the Parties page's Record Payment already uses.
  function handleContinueCorrection(event) {
    event.preventDefault();
    setFormError(null);
    const qty = Number(qtySets);
    if (!qtySets || !Number.isInteger(qty) || qty <= 0) {
      setFormError('Enter a valid whole number of sets, greater than 0.');
      return;
    }
    if (!locationId) {
      setFormError('Pick a location.');
      return;
    }
    if (!bundleId) {
      setFormError('Pick an article and colour.');
      return;
    }
    if (!reason) {
      setFormError('Pick a reason.');
      return;
    }
    if (reason === 'OTHER' && !note.trim()) {
      setFormError('A note is required when the reason is Other.');
      return;
    }
    let priceNum;
    if (touchPrice) {
      priceNum = Number(costPrice);
      if (costPrice === '' || !Number.isFinite(priceNum) || priceNum < 0) {
        setFormError('Enter a valid cost price (0 or more).');
        return;
      }
    }
    const payload = {
      transactionId: correctingId,
      bundleId,
      locationId,
      qtySets: qty,
      reason,
      note: note.trim() || undefined,
    };
    if (touchPrice) payload.costPrice = priceNum;
    setDraft(payload);
  }

  function finishCorrection() {
    setCorrectingId(null);
    setDraft(null);
    setCorrectionSuccess('Receipt corrected.');
    setTimeout(() => setCorrectionSuccess(null), 3000);
    loadHistory();
  }

  // Used only when the correction does NOT touch price — no PinPrompt in the picture, so this
  // owns its own submitting/error state instead of PinPrompt's.
  async function handleConfirmNoPin() {
    setConfirmSubmitting(true);
    setFormError(null);
    try {
      await createTransactionCorrection(draft);
      finishCorrection();
    } catch (err) {
      setFormError(err.message);
      setConfirmSubmitting(false);
    }
  }

  // Used only when the correction DOES touch price — PinPrompt calls this with just the pin;
  // throws on failure, which PinPrompt's own error/lockout handling catches.
  async function handleConfirmWithPin(pin) {
    await createTransactionCorrection({ ...draft, pin });
    finishCorrection();
  }

  function handleStartCorrectTransfer(entry) {
    setCorrectingTransferId(entry.transferId);
    setTransferQtySets(String(entry.qtySets));
    setTransferFromLocationId(entry.fromLocationId);
    setTransferToLocationId(entry.toLocationId);
    setTransferReason('');
    setTransferNote('');
    setTransferFormError(null);
    setTransferDraft(null);
  }

  function handleCancelCorrectTransfer() {
    setCorrectingTransferId(null);
    setTransferDraft(null);
    setTransferFormError(null);
  }

  // Single step of validation before a plain confirm button — no PIN branch exists for this form
  // at all (see header comment), so this always lands on the same "Confirm correction" control,
  // never PinPrompt.
  function handleContinueCorrectTransfer(event) {
    event.preventDefault();
    setTransferFormError(null);
    const qty = Number(transferQtySets);
    if (!transferQtySets || !Number.isInteger(qty) || qty <= 0) {
      setTransferFormError('Enter a valid whole number of sets, greater than 0.');
      return;
    }
    if (!transferFromLocationId || !transferToLocationId) {
      setTransferFormError('Pick both locations.');
      return;
    }
    if (transferFromLocationId === transferToLocationId) {
      setTransferFormError('From and to locations must be different.');
      return;
    }
    if (!transferReason) {
      setTransferFormError('Pick a reason.');
      return;
    }
    if (transferReason === 'OTHER' && !transferNote.trim()) {
      setTransferFormError('A note is required when the reason is Other.');
      return;
    }
    setTransferDraft({
      transferId: correctingTransferId,
      fromLocationId: transferFromLocationId,
      toLocationId: transferToLocationId,
      qtySets: qty,
      reason: transferReason,
      note: transferNote.trim() || undefined,
    });
  }

  async function handleConfirmTransferCorrection() {
    setTransferConfirmSubmitting(true);
    setTransferFormError(null);
    try {
      await createTransferCorrection(transferDraft);
      setCorrectingTransferId(null);
      setTransferDraft(null);
      setCorrectionSuccess('Transfer corrected.');
      setTimeout(() => setCorrectionSuccess(null), 3000);
      loadHistory();
    } catch (err) {
      setTransferFormError(err.message);
    } finally {
      setTransferConfirmSubmitting(false);
    }
  }

  // Same "insert a heading only when the calendar day changes" grouping as staff's screen —
  // the server already sorts newest-first, this never re-sorts.
  const days = [];
  entries.forEach((entry) => {
    const heading = formatDayHeading(entry.timestamp);
    const last = days[days.length - 1];
    if (!last || last.heading !== heading) {
      days.push({ heading, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  });

  if (status !== 'loaded') {
    return (
      <>
        {error && (
          <p className="error-banner" role="alert">
            Could not load history: {error}
          </p>
        )}
        {!error && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          Could not refresh history: {error}
        </p>
      )}
      {correctionSuccess && <p className="dash-party-payment-success">{correctionSuccess}</p>}

      {entries.length === 0 ? (
        <p className="muted dash-empty">Nothing recorded yet.</p>
      ) : (
        days.map((day) => (
          <div key={day.heading} className="history-day">
            <div className="eyebrow history-day-heading">{day.heading}</div>
            <div className="dash-card history-day-card">
              {day.entries.map((entry) => {
                const badgeClass = TYPE_BADGE_CLASSES[entry.type] ?? FALLBACK_BADGE_CLASS;
                const actorColor = actorBadgeColorFor(entry.actorName);
                const isReceipt = entry.type === 'RECEIPT';
                const correcting = isReceipt && correctingId === entry.transactionId;
                const isTransfer = entry.type === 'TRANSFER';
                const correctingTransfer = isTransfer && correctingTransferId === entry.transferId;
                return (
                  <div key={entry.id} className="history-row">
                    <div className="history-row-top">
                      <span className={`badge ${badgeClass}`}>{entry.label ?? FALLBACK_LABEL}</span>
                      <span className="muted history-row-time">{formatTime(entry.timestamp)}</span>
                    </div>
                    <p className="history-row-description">{entry.description}</p>
                    <p className="history-row-actor">
                      <span
                        className="badge history-actor-badge"
                        style={{ background: actorColor.bg, color: actorColor.text }}
                      >
                        {entry.actorName}
                      </span>
                      {entry.partyName ? <span className="muted">· {entry.partyName}</span> : null}
                    </p>

                    {isReceipt && !entry.corrected && !correcting && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleStartCorrect(entry)}
                      >
                        Correct
                      </button>
                    )}
                    {isReceipt && entry.corrected && (
                      <span className="muted history-row-corrected-note">Already corrected</span>
                    )}

                    {correcting && (
                      <div className="dash-history-correction">
                        {!draft ? (
                          <form onSubmit={handleContinueCorrection}>
                            <label className="field">
                              <span className="field-label">Quantity (sets)</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                step="1"
                                value={qtySets}
                                onChange={(e) => setQtySets(e.target.value)}
                                required
                              />
                            </label>

                            <label className="field">
                              <span className="field-label">Location</span>
                              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
                                {locations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <div className="field">
                              <span className="field-label">Article / colour</span>
                              {!changingArticle ? (
                                <div className="lookup-banner lookup-banner-success">
                                  <p>{articleDisplay}</p>
                                  <button
                                    type="button"
                                    className="link-button"
                                    onClick={() => {
                                      setChangingArticle(true);
                                      resetArticleSearch();
                                    }}
                                  >
                                    Change
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="article-lookup-row">
                                    <input
                                      type="text"
                                      value={articleNoInput}
                                      onChange={(e) => setArticleNoInput(e.target.value)}
                                      disabled={!!resolvedProduct}
                                      placeholder="e.g. A101"
                                      autoCapitalize="characters"
                                    />
                                    {!resolvedProduct && (
                                      <button
                                        type="button"
                                        className="btn-primary btn-inline"
                                        onClick={handleSearchArticle}
                                        disabled={searching}
                                      >
                                        {searching ? 'Searching…' : 'Search'}
                                      </button>
                                    )}
                                  </div>

                                  {searchError && (
                                    <p className="error-banner" role="alert">
                                      {searchError}
                                    </p>
                                  )}

                                  {disambiguationOptions && (
                                    <div className="chip-row">
                                      {disambiguationOptions.map((p) => (
                                        <button
                                          key={p.id}
                                          type="button"
                                          className="chip"
                                          onClick={() => {
                                            setResolvedProduct(p);
                                            setDisambiguationOptions(null);
                                          }}
                                        >
                                          {p.name} — {factoryName(p.factoryId)}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {resolvedProduct && (
                                    <>
                                      <div className="lookup-banner lookup-banner-success">
                                        <p>
                                          <strong>{resolvedProduct.articleNo}</strong> — {resolvedProduct.name}
                                        </p>
                                        <button type="button" className="link-button" onClick={resetArticleSearch}>
                                          Change
                                        </button>
                                      </div>

                                      {colorsError && (
                                        <p className="error-banner" role="alert">
                                          Could not load colors: {colorsError}
                                        </p>
                                      )}

                                      {colorsStatus === 'loaded' && colors.length > 0 && (
                                        <div className="chip-row">
                                          {colors.map((c) => (
                                            <button
                                              key={c.id}
                                              type="button"
                                              className="chip"
                                              onClick={() => handlePickColor(c)}
                                            >
                                              {c.name}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>

                            <label className="field checkbox-field">
                              <input
                                type="checkbox"
                                checked={touchPrice}
                                onChange={(e) => setTouchPrice(e.target.checked)}
                              />
                              <span>Cost price was also wrong</span>
                            </label>
                            {touchPrice && (
                              <label className="field">
                                <span className="field-label">Corrected cost price (per piece)</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  step="0.01"
                                  value={costPrice}
                                  onChange={(e) => setCostPrice(e.target.value)}
                                  required
                                />
                              </label>
                            )}

                            <label className="field">
                              <span className="field-label">Reason</span>
                              <select value={reason} onChange={(e) => setReason(e.target.value)} required>
                                <option value="" disabled>
                                  Select a reason
                                </option>
                                {CORRECTION_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">Note {reason === 'OTHER' ? '' : '(optional)'}</span>
                              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
                            </label>

                            {formError && (
                              <p className="error-banner" role="alert">
                                {formError}
                              </p>
                            )}

                            <button type="submit" className="btn-primary">
                              Continue
                            </button>
                            <button type="button" className="btn-secondary" onClick={handleCancelCorrect}>
                              Cancel
                            </button>
                          </form>
                        ) : touchPrice ? (
                          <div>
                            <p className="muted">Cost price is changing — enter your PIN to confirm this correction.</p>
                            <PinPrompt
                              submitLabel="Confirm correction"
                              submittingLabel="Correcting…"
                              autoFocus
                              onSubmit={handleConfirmWithPin}
                            />
                            <button type="button" className="link-button" onClick={() => setDraft(null)}>
                              Change details
                            </button>
                          </div>
                        ) : (
                          <div>
                            {formError && (
                              <p className="error-banner" role="alert">
                                {formError}
                              </p>
                            )}
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={handleConfirmNoPin}
                              disabled={confirmSubmitting}
                            >
                              {confirmSubmitting ? 'Correcting…' : 'Confirm correction'}
                            </button>
                            <button type="button" className="link-button" onClick={() => setDraft(null)}>
                              Change details
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isTransfer && !entry.corrected && !correctingTransfer && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleStartCorrectTransfer(entry)}
                      >
                        Correct
                      </button>
                    )}
                    {isTransfer && entry.corrected && (
                      <span className="muted history-row-corrected-note">Already corrected</span>
                    )}

                    {correctingTransfer && (
                      <div className="dash-history-correction">
                        {!transferDraft ? (
                          <form onSubmit={handleContinueCorrectTransfer}>
                            <label className="field">
                              <span className="field-label">Quantity (sets)</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="1"
                                step="1"
                                value={transferQtySets}
                                onChange={(e) => setTransferQtySets(e.target.value)}
                                required
                              />
                            </label>

                            <label className="field">
                              <span className="field-label">From location</span>
                              <select
                                value={transferFromLocationId}
                                onChange={(e) => setTransferFromLocationId(e.target.value)}
                                required
                              >
                                {locations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">To location</span>
                              <select
                                value={transferToLocationId}
                                onChange={(e) => setTransferToLocationId(e.target.value)}
                                required
                              >
                                {locations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="field">
                              <span className="field-label">Reason</span>
                              <select
                                value={transferReason}
                                onChange={(e) => setTransferReason(e.target.value)}
                                required
                              >
                                <option value="" disabled>
                                  Select a reason
                                </option>
                                {TRANSFER_CORRECTION_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">
                                Note {transferReason === 'OTHER' ? '' : '(optional)'}
                              </span>
                              <input
                                type="text"
                                value={transferNote}
                                onChange={(e) => setTransferNote(e.target.value)}
                              />
                            </label>

                            {transferFormError && (
                              <p className="error-banner" role="alert">
                                {transferFormError}
                              </p>
                            )}

                            <button type="submit" className="btn-primary">
                              Continue
                            </button>
                            <button type="button" className="btn-secondary" onClick={handleCancelCorrectTransfer}>
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <div>
                            {transferFormError && (
                              <p className="error-banner" role="alert">
                                {transferFormError}
                              </p>
                            )}
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={handleConfirmTransferCorrection}
                              disabled={transferConfirmSubmitting}
                            >
                              {transferConfirmSubmitting ? 'Correcting…' : 'Confirm correction'}
                            </button>
                            <button type="button" className="link-button" onClick={() => setTransferDraft(null)}>
                              Change details
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
