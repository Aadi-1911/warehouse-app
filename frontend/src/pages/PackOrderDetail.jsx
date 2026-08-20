import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PackageIcon,
  CheckCircleIcon,
  WarningTriangleIcon,
  NotStartedIcon,
  ChevronIcon,
} from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import { getOrder, packOrder, cancelOrderLine, cancelOrder } from '../api/orders';
import { listStock } from '../api/stock';
import { LOW_STOCK_THRESHOLD } from '../utils/lowStock';

// Pack Order — Pack List detail, 07_UI_DESIGN_BRIEF.md §5.4 (both the original and "— updated"
// sections). Tally view and "Mark shipped" are both out of scope here — Tally is a separate
// flat-checklist follow-up, and shipping needs Billed first, which has a backend endpoint
// (PATCH /api/orders/:id/bill, OWNER-only) but no UI on any screen yet.
//
// Packing no longer moves stock (backend change 2026-08-17) — this screen confirms COUNTS, and
// the actual deduction happens later at Bill. The stock numbers shown per line are still real and
// still worth showing: they're what staff use to decide how much they can actually pack.
//
// Rule 56's low-stock badge (added 2026-08-20, via the shared LOW_STOCK_THRESHOLD) reads straight
// off this same stockByBundleId — no "before/after this order" adjustment needed, because packing
// never touches Stock any more (see above): today's real number already IS what it'll be right up
// until Bill, regardless of what this order itself packs.
//
// --- CHECKLIST-FIRST, not quantity-first (redesigned 2026-08-19) ---
// This screen used to pre-fill every line's stepper to the ordered quantity and track which of
// those defaults a human had engaged with in a separate `touchedLines` Set. That worked, but it
// meant every line rendered a settled-looking number before anyone had looked at a shelf, and an
// untouched line submitted at that number silently. The old model needed a long comment
// explaining why "value equals ordered" and "a human confirmed this" were different facts —
// which was the tell that the state shape was wrong, not just under-documented.
//
// Now there is ONE piece of state, `confirmed`, keyed by lineItemId:
//   - key ABSENT  -> unconfirmed. Nothing is displayed as decided. This is the load state.
//   - key present -> confirmed, and the value IS the qtySetsPacked to submit.
//
// Absence-means-unconfirmed makes the two bugs the old pair could express unrepresentable: there
// is no way to be confirmed without a quantity, and no way for a quantity to imply confirmation.
// Same discipline CLAUDE.md already requires for async status (never alias "hasn't started" onto
// a boolean's default) — applied here to a manual-confirmation status instead of a fetch status.
//
// Two distinct affordances per row, deliberately NOT the same tap target:
//   - the row's main area  -> confirm packed-in-full (one tap, the overwhelmingly common case).
//     Tapping again un-confirms, so a mistap is recoverable without hunting for an undo.
//   - a separate "Adjust"  -> opens the stepper for the less-than-ordered case, which then has
//     its own explicit Confirm. Opening the stepper is NOT itself a confirmation.
// They're siblings rather than nested because a <button> inside a <button> is invalid HTML and
// browsers drop the inner one's events.
//
// WHAT AN UNCONFIRMED LINE SUBMITS, and why it isn't zero. PATCH /api/orders/:id/pack requires
// full coverage — exactly one entry per non-cancelled line (orderController.js) — so "mark packed
// anyway" still has to send a number for lines nobody touched. That number is the ORDERED
// quantity, making the payload byte-identical to what this screen sent before the redesign.
// Zero would be actively wrong: it means short-packed-to-nothing, and would write SHORT_PACKED
// adjustments against lines no one ever said were short. The real change here is that staff are
// now TOLD which lines are going through unconfirmed, by name, before it happens — informed, not
// blocked, matching how this app already handles real warnings elsewhere.
//
// No backend change: the request body's shape and values are unchanged. This is entirely about
// how staff arrive at that payload.

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function PackOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Cancellation is OWNER-only (the API enforces it with requireRole); this only decides whether
  // to render a control staff could never successfully use.
  const { user } = useAuth();
  const canCancel = user.role === 'OWNER';

  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState(null);
  const [stockByBundleId, setStockByBundleId] = useState({});

  // { [lineItemId]: qtySetsPacked } — PRESENCE is the confirmation, the value is what gets
  // submitted. Starts empty on purpose: nothing is confirmed until a human taps it. See the
  // block comment above for why this replaced the old packingQty/touchedLines pair.
  const [confirmed, setConfirmed] = useState({});

  // { [lineItemId]: qtySetsPacked } — lines whose stepper is currently OPEN, with the in-progress
  // value. Separate from `confirmed` because opening the stepper isn't confirming anything:
  // staff can open it, look at the stock figure, and back out having decided nothing. A line can
  // legitimately be confirmed AND open (adjusting something already confirmed).
  const [adjusting, setAdjusting] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Non-null only while the "some lines are still unconfirmed" warning is up; holds the exact
  // lines being warned about so the copy can name them rather than just counting them.
  const [unconfirmedWarning, setUnconfirmedWarning] = useState(null);

  // One target for both cancel actions, same shape Parties.jsx uses for its archive/reactivate
  // confirm — { kind: 'line', line } or { kind: 'order' }. A single ConfirmModal serves both, with
  // copy that differs sharply so the two can never be mistaken for one another.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  // Shared accordion state (Live Stock's .accordion-header/.accordion-body pattern, reused
  // rather than a bespoke implementation) grouping lines by article — collapsed by default,
  // same convention as New Order's own Order Summary and every other accordion in this app.
  const [expandedArticles, setExpandedArticles] = useState(() => new Set());

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setOrderStatus('loading');
    setOrderError(null);
    // listStock() unfiltered — same "fetch the full list, group client-side" pattern Live Stock
    // already established (api/stock.js's own comment), reused here since this screen needs
    // real numbers across however many distinct bundles this order's lines touch, not one
    // article's worth like New Order's own per-search stock check.
    Promise.all([getOrder(id), listStock()])
      .then(([orderData, stockRows]) => {
        if (cancelled) return;
        setOrder(orderData);
        const totals = {};
        stockRows.forEach((r) => {
          totals[r.bundleId] = (totals[r.bundleId] ?? 0) + r.qtySets;
        });
        setStockByBundleId(totals);
        // Deliberately NO seeding of `confirmed` here. The whole point of the redesign is that
        // the screen loads with nothing confirmed; pre-filling it would recreate exactly the
        // silently-settled state this replaced.
      })
      .catch((err) => {
        if (!cancelled) setOrderError(err.message);
      })
      .finally(() => {
        if (!cancelled) setOrderStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The one-tap common case: confirm this line at the full ordered quantity. Tapping a
  // already-confirmed line clears it back to unconfirmed — a mistap has to be undoable, and
  // toggling the same target is the gesture staff will reach for first.
  function toggleConfirmFull(lineItemId, ordered) {
    setConfirmed((prev) => {
      const next = { ...prev };
      if (lineItemId in next) delete next[lineItemId];
      else next[lineItemId] = ordered;
      return next;
    });
    // Un-confirming while its stepper is open would leave an orphaned editor for a line that no
    // longer has a decision attached, so close it either way.
    setAdjusting((prev) => {
      const next = { ...prev };
      delete next[lineItemId];
      return next;
    });
  }

  // Opens the stepper. Seeds from the line's confirmed value when it has one (so re-adjusting a
  // short line starts where it was left), otherwise from the ordered quantity — the natural
  // reference point staff count down from.
  function openAdjust(lineItemId, ordered) {
    setAdjusting((prev) => ({ ...prev, [lineItemId]: confirmed[lineItemId] ?? ordered }));
  }

  function closeAdjust(lineItemId) {
    setAdjusting((prev) => {
      const next = { ...prev };
      delete next[lineItemId];
      return next;
    });
  }

  function stepAdjust(lineItemId, ordered, delta) {
    setAdjusting((prev) => {
      const current = prev[lineItemId] ?? ordered;
      // Hard clamp client-side (0..ordered) — the backend REJECTS an out-of-range value rather
      // than clamping it (04_API_SPEC.md), so the stepper itself must never be able to produce
      // one in the first place, not just rely on the server catching it after the fact.
      const next = Math.max(0, Math.min(ordered, current + delta));
      return { ...prev, [lineItemId]: next };
    });
  }

  // The stepper's own explicit commit. Confirming at exactly the ordered quantity is a normal
  // full confirm, not a special case — the row simply renders green instead of amber.
  function confirmAdjusted(lineItemId, ordered) {
    const qty = adjusting[lineItemId] ?? ordered;
    setConfirmed((prev) => ({ ...prev, [lineItemId]: qty }));
    closeAdjust(lineItemId);
  }

  async function handleConfirmCancel() {
    setCancelError(null);
    setCancelling(true);
    try {
      if (cancelTarget.kind === 'order') {
        await cancelOrder(id);
        setCancelTarget(null);
        // A cancelled order no longer belongs on the Pack worklist, so go back to it rather than
        // leaving the owner on a detail screen for something that's no longer actionable.
        navigate('/pack-orders', { replace: true, state: { cancelledOutcome: { partyName: order.partyName } } });
        return;
      }
      // Line cancel: the endpoint returns the whole updated order, so this re-renders from real
      // server state rather than patching the local copy and hoping it matches.
      const updated = await cancelOrderLine(id, cancelTarget.line.id);
      setOrder(updated);
      setCancelTarget(null);
    } catch (err) {
      setCancelTarget(null);
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  // Entry point for the "Mark as packed" button. Checks for unconfirmed lines FIRST and, if any
  // exist, shows a warning naming them rather than submitting. Deliberately not a hard block —
  // staff can still proceed, same "inform clearly, let the person decide" shape this app already
  // uses for real warnings.
  function handleMarkPackedClick() {
    const stillUnconfirmed = order.lineItems.filter((li) => !li.isCancelled && !(li.id in confirmed));
    if (stillUnconfirmed.length > 0) {
      setUnconfirmedWarning(stillUnconfirmed);
      return;
    }
    doMarkPacked();
  }

  async function doMarkPacked() {
    setUnconfirmedWarning(null);
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Every non-cancelled line, not just the confirmed ones — the backend requires full
      // coverage (04_API_SPEC.md's PATCH /:id/pack). An unconfirmed line falls back to its
      // ordered quantity, which keeps this payload identical to what this screen sent before the
      // checklist redesign; see the block comment at the top for why that fallback isn't 0.
      // Cancelled lines are excluded — they have nothing to pack, and the backend's coverage
      // check expects exactly the non-cancelled lines.
      const lineItemsPayload = order.lineItems
        .filter((li) => !li.isCancelled)
        .map((li) => ({
          lineItemId: li.id,
          qtySetsPacked: confirmed[li.id] ?? li.qtySetsRequested,
        }));
      await packOrder(id, lineItemsPayload);
      const liveForOutcome = order.lineItems.filter((li) => !li.isCancelled);
      const shortCount = liveForOutcome.filter(
        (li) => (confirmed[li.id] ?? li.qtySetsRequested) < li.qtySetsRequested
      ).length;
      navigate('/pack-orders', {
        replace: true,
        state: {
          packedOutcome: { partyName: order.partyName, lineCount: liveForOutcome.length, shortCount },
        },
      });
    } catch (err) {
      // Deliberately not resetting `confirmed` — someone else packing this order first
      // (ORDER_NOT_PLACED) must never cost staff the row-by-row confirmations they just worked
      // through. They see the real message and either retry or back out via ScreenHeader.
      // (Packing can no longer fail on INSUFFICIENT_STOCK — it doesn't touch stock at all now;
      // that moved to Bill.)
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (orderStatus !== 'loaded') {
    return (
      <div className="page">
        <ScreenHeader icon={<PackageIcon size={20} />} tone="warning" title="Pack Order" />
        {orderError ? (
          <p className="error-banner" role="alert">
            Could not load this order: {orderError}
          </p>
        ) : (
          <p className="muted centered-empty-state">Loading…</p>
        )}
      </div>
    );
  }

  // A direct link or a stale list row could point at an order someone else already packed (or
  // further along) between when the list loaded and now — same class of race the submit-time
  // ORDER_NOT_PLACED check guards against, just caught earlier, before any stepper is even shown.
  if (order.status !== 'PLACED') {
    return (
      <div className="page">
        <ScreenHeader icon={<PackageIcon size={20} />} tone="warning" title="Pack Order" />
        <p className="muted">{order.partyName}</p>
        <p className="error-banner" role="alert">
          This order is no longer open for packing — its status is now {order.status}.
        </p>
      </div>
    );
  }

  // Everything below counts LIVE lines only — a cancelled line isn't "not started", it's out of
  // scope entirely, and folding it into the tally would make the footer permanently unfinishable.
  const liveLines = order.lineItems.filter((li) => !li.isCancelled);
  const cancelledCount = order.lineItems.length - liveLines.length;
  const total = liveLines.length;

  // The single place a line's state is decided, so the row treatment, the per-article badge and
  // the footer tally can never disagree about what a line is. Reads straight off `confirmed`:
  // absent -> unconfirmed, present-and-equal -> full, present-and-less -> short.
  function lineState(li) {
    if (!(li.id in confirmed)) return 'unconfirmed';
    return confirmed[li.id] < li.qtySetsRequested ? 'short' : 'full';
  }

  const tally = liveLines.reduce(
    (acc, li) => {
      acc[lineState(li)] += 1;
      return acc;
    },
    { full: 0, short: 0, unconfirmed: 0 }
  );
  const tallyText =
    `${tally.full} of ${total} item${total === 1 ? '' : 's'} confirmed packed` +
    (tally.short > 0 ? ` · ${tally.short} short` : '') +
    (tally.unconfirmed > 0 ? ` · ${tally.unconfirmed} not confirmed` : '') +
    (cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : '');

  // Group by article (productId) — same grouping New Order's own Order Summary uses, built
  // fresh each render from the already-fetched order rather than kept as separate state.
  const groupedLineItems = order.lineItems
    .reduce((groups, li) => {
      let group = groups.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [] };
        groups.push(group);
      }
      group.lines.push(li);
      return groups;
    }, [])
    .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

  return (
    <div className="page">
      <ScreenHeader icon={<PackageIcon size={20} />} tone="warning" title="Pack Order" />
      <p className="muted">{order.partyName}</p>
      <span className="badge badge-warning">Placed</span>

      {submitError && (
        <p className="error-banner" role="alert">
          Could not mark this order as packed: {submitError}
        </p>
      )}

      {cancelError && (
        <p className="error-banner" role="alert">
          Could not cancel: {cancelError}
        </p>
      )}

      <div className="card">
        {groupedLineItems.map((group) => {
          const open = expandedArticles.has(group.productId);
          return (
            <div key={group.productId} className="accordion-section nested">
              <button
                type="button"
                className="accordion-header nested"
                onClick={() => toggleArticle(group.productId)}
                aria-expanded={open}
              >
                <div className="accordion-header-text">
                  <div className="accordion-title-sm">
                    {group.articleNo}
                    <span className="muted"> — {group.productName}</span>
                  </div>
                  {/* On the COLLAPSED header, so progress is readable without expanding every
                      article one by one — the same place BillOrderDetail surfaces its own
                      per-article blocked count, reused rather than invented here. */}
                  {(() => {
                    const groupLive = group.lines.filter((li) => !li.isCancelled);
                    if (groupLive.length === 0) return null;
                    const groupDone = groupLive.filter((li) => lineState(li) !== 'unconfirmed').length;
                    const groupShort = groupLive.filter((li) => lineState(li) === 'short').length;
                    const allDone = groupDone === groupLive.length;
                    return (
                      <div className="accordion-subtitle">
                        <span
                          className={`badge ${allDone ? 'badge-success' : 'badge-warning'} accordion-low-badge`}
                        >
                          {groupDone}/{groupLive.length} confirmed
                        </span>
                        {groupShort > 0 && (
                          <span className="badge badge-warning accordion-low-badge">
                            {groupShort} short
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {open && (
                <div className="accordion-body nested">
                  {group.lines.map((li) => {
                    // Cancelled lines stay VISIBLE, struck through — the order's line history is
                    // part of the record ("never hard-delete"), and a line vanishing entirely
                    // would leave the owner unsure whether they cancelled it or imagined it.
                    if (li.isCancelled) {
                      return (
                        <div key={li.id} className="pack-line-row pack-line-row-cancelled">
                          <div className="pack-line-row-header">
                            <span className="pack-line-color-chip">{li.colorName}</span>
                            <span className="badge badge-danger">Cancelled</span>
                          </div>
                          <p className="pack-line-ordered">Ordered: {pluralSets(li.qtySetsRequested)}</p>
                        </div>
                      );
                    }
                    const ordered = li.qtySetsRequested;
                    const state = lineState(li);
                    const isShort = state === 'short';
                    const isFull = state === 'full';
                    const stockAvail = stockByBundleId[li.bundleId] ?? 0;
                    const low = stockAvail <= LOW_STOCK_THRESHOLD;
                    const isAdjusting = li.id in adjusting;
                    const adjustQty = adjusting[li.id] ?? confirmed[li.id] ?? ordered;

                    let StatusIcon = NotStartedIcon;
                    let statusClass = 'pack-line-status-not-started';
                    if (isShort) {
                      StatusIcon = WarningTriangleIcon;
                      statusClass = 'pack-line-status-short';
                    } else if (isFull) {
                      StatusIcon = CheckCircleIcon;
                      statusClass = 'pack-line-status-full';
                    }

                    return (
                      <div
                        key={li.id}
                        className={`pack-line-row ${isShort ? 'pack-line-row-short' : ''} ${
                          isFull ? 'pack-line-row-confirmed' : ''
                        }`}
                      >
                        {/* Two sibling controls, never nested — a <button> inside a <button> is
                            invalid HTML and browsers drop the inner one's events. The main area
                            is the one-tap full confirm; "Adjust" is a visually distinct, much
                            smaller target for the less-common short-pack case. */}
                        <div className="pack-line-row-header">
                          <button
                            type="button"
                            className="pack-line-tap"
                            onClick={() => toggleConfirmFull(li.id, ordered)}
                            disabled={submitting}
                            aria-pressed={isFull || isShort}
                            aria-label={
                              isFull || isShort
                                ? `Undo confirmation for ${li.colorName}`
                                : `Confirm ${li.colorName} packed in full, ${pluralSets(ordered)}`
                            }
                          >
                            <span className={statusClass}>
                              <StatusIcon size={18} />
                            </span>
                            <span className="pack-line-tap-text">
                              <span className="pack-line-color-row">
                                <span className="pack-line-color-chip">{li.colorName}</span>
                                {/* Rule 56: a small red flag, never a fully-tinted row — same
                                    badge-danger treatment Live Stock/New Order use, reused rather
                                    than a new style. Shown regardless of confirm state: it's a
                                    fact about current stock, not about this line's own progress. */}
                                {low && <span className="badge badge-danger">Low stock</span>}
                              </span>
                              <span className="pack-line-ordered">
                                {isShort
                                  ? `Ordered: ${ordered} · Only ${stockAvail} in stock`
                                  : isFull
                                  ? `Packed in full · ${pluralSets(ordered)}`
                                  : `Ordered: ${pluralSets(ordered)} · tap to confirm`}
                              </span>
                            </span>
                          </button>

                          <button
                            type="button"
                            className="pack-line-adjust-btn"
                            onClick={() => (isAdjusting ? closeAdjust(li.id) : openAdjust(li.id, ordered))}
                            disabled={submitting}
                            aria-expanded={isAdjusting}
                            aria-label={`Adjust packed quantity for ${li.colorName}`}
                          >
                            {isAdjusting ? 'Close' : 'Adjust'}
                          </button>
                        </div>

                        {/* Only rendered once staff explicitly ask for it. Opening it changes
                            nothing on its own — the Confirm button below is what commits. */}
                        {isAdjusting && (
                          <div className="pack-line-adjust-panel">
                            <div className="pack-line-stepper-row">
                              <div className="stepper">
                                <button
                                  type="button"
                                  className="stepper-btn"
                                  onClick={() => stepAdjust(li.id, ordered, -1)}
                                  disabled={adjustQty === 0 || submitting}
                                  aria-label={`Decrease packed sets for ${li.colorName}`}
                                >
                                  −
                                </button>
                                <span className="stepper-value">{adjustQty}</span>
                                <button
                                  type="button"
                                  className="stepper-btn"
                                  onClick={() => stepAdjust(li.id, ordered, 1)}
                                  disabled={adjustQty >= ordered || submitting}
                                  aria-label={`Increase packed sets for ${li.colorName}`}
                                >
                                  +
                                </button>
                              </div>
                              <span className="muted">In stock: {stockAvail}</span>
                            </div>
                            <button
                              type="button"
                              className="btn-primary pack-line-adjust-confirm"
                              onClick={() => confirmAdjusted(li.id, ordered)}
                              disabled={submitting}
                            >
                              Confirm {pluralSets(adjustQty)}
                            </button>
                          </div>
                        )}

                        {isShort && (
                          <p className="pack-line-shortfall-note">
                            Packing {pluralSets(confirmed[li.id])} of {ordered}. This will be recorded as a
                            short-pack — the ordered quantity stays {ordered}; only how much actually gets packed
                            changes.
                          </p>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="link-button danger-text line-cancel-link"
                            onClick={() => setCancelTarget({ kind: 'line', line: li })}
                            disabled={submitting || cancelling}
                          >
                            Cancel this line
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky-action-bar">
        <p className="muted pack-order-tally">{tallyText}</p>
        <button type="button" className="btn-primary" onClick={handleMarkPackedClick} disabled={submitting}>
          {submitting ? 'Marking as packed…' : 'Mark as packed'}
        </button>
        {/* Visually separated from "Mark as packed" and from the per-line links: cancelling the
            whole order is a different scale of action, and the two must never be tapped by
            mistake for one another. */}
        {canCancel && (
          <button
            type="button"
            className="btn-danger order-cancel-button"
            onClick={() => setCancelTarget({ kind: 'order' })}
            disabled={submitting || cancelling}
          >
            Cancel this order
          </button>
        )}
      </div>

      {/* A WARNING, not a block. Staff can still proceed — same "inform clearly, let the person
          decide" shape used elsewhere in this app — but the lines going through unconfirmed are
          named explicitly, and the copy states exactly what will be recorded for them, since
          "confirm anyway" quietly meaning "packed in full" is the one thing that would make this
          worse than the old silent behaviour rather than better. tone="accent": proceeding is a
          normal choice here, not a destructive one, so it must not borrow the cancel actions' red. */}
      <ConfirmModal
        open={!!unconfirmedWarning}
        title={`${unconfirmedWarning?.length ?? 0} line${
          unconfirmedWarning?.length === 1 ? '' : 's'
        } not confirmed yet`}
        body={
          unconfirmedWarning
            ? `Still unconfirmed: ${unconfirmedWarning
                .map((li) => `${li.productArticleNo} ${li.colorName}`)
                .join(', ')}. Going ahead records ${
                unconfirmedWarning.length === 1 ? 'it' : 'them'
              } as packed in full at the ordered quantity. Go back to confirm ${
                unconfirmedWarning.length === 1 ? 'it' : 'them'
              } one by one, or mark the order packed anyway.`
            : ''
        }
        confirmLabel="Mark packed anyway"
        // NOT the default "Cancel" — this screen has "Cancel this line" and "Cancel this order"
        // actions, so an unqualified "Cancel" here could read as cancelling the order itself.
        cancelLabel="Go back and confirm"
        tone="accent"
        onConfirm={doMarkPacked}
        onCancel={() => setUnconfirmedWarning(null)}
      />

      <ConfirmModal
        open={!!cancelTarget}
        title={cancelTarget?.kind === 'order' ? 'Cancel this whole order?' : 'Cancel this line?'}
        body={
          cancelTarget?.kind === 'order'
            ? `${order.partyName}'s entire order will be cancelled and removed from the packing list. The lines stay on record — nothing is deleted — but the order can't be packed, billed or shipped afterwards.`
            : `${cancelTarget?.line.colorName} will be cancelled and won't be packed or billed. The ordered quantity stays on record; only the line is marked cancelled.`
        }
        confirmLabel={cancelling ? 'Cancelling…' : cancelTarget?.kind === 'order' ? 'Cancel whole order' : 'Cancel line'}
        tone="danger"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
