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
import { getOrder, packOrder } from '../api/orders';
import { listStock } from '../api/stock';

// Pack Order — Pack List detail, 07_UI_DESIGN_BRIEF.md §5.4 (both the original and "— updated"
// sections). Tally view and "Mark shipped" are both out of scope here — Tally is a separate
// flat-checklist follow-up, and shipping needs Billed first, which has a backend endpoint
// (PATCH /api/orders/:id/bill, OWNER-only) but no UI on any screen yet.
//
// Packing no longer moves stock (backend change 2026-08-17) — this screen confirms COUNTS, and
// the actual deduction happens later at Bill. The stock numbers shown per line are still real and
// still worth showing: they're what staff use to decide how much they can actually pack.
//
// --- On the "not started" status icon's meaning (worth spelling out, since it's the one place
// this screen's own spec is genuinely ambiguous) ---
// Every stepper DEFAULTS to the ordered quantity (§5.4's own words), which means the instant
// this screen loads, every line's packing value already numerically equals what was ordered —
// the same condition the green check icon is supposed to mean. Read literally and arithmetic-
// first, "green check = packing qty equals ordered qty" would make every single line show green
// before a human has looked at anything, which would make the dashed "not started" icon
// unreachable in practice and defeat the entire point of having three distinct states: staff
// would have no way to see, at a glance, which lines they've actually verified against the
// shelf versus which ones are just sitting on their untouched default.
//
// So "not started" is tracked as its own explicit fact — which lines this session has actually
// touched (touchedLines below) — checked BEFORE the arithmetic comparison, not derived from it.
// A line reads dashed until a human adjusts its stepper at all (even a tap that lands back on
// the same number still counts as "looked at and confirmed"), green once touched and still at
// the ordered figure, amber once touched and reduced below it. This mirrors CLAUDE.md's own
// rule against aliasing a real "not yet interacted with" state onto a value that merely happens
// to match a different real state by default — same shape as the idle/loading/loaded rule for
// async status, applied here to a manual-confirmation status instead of a fetch status.
//
// The amber CARD TINT is a separate, simpler signal from the icon: it fires purely off
// `packingQty < ordered`, regardless of touched state. In practice the two can never actually
// diverge — an untouched line is always exactly at its ordered default, so it can never be
// short — but they're deliberately independent checks, not one derived from the other, because
// they answer different questions ("is this line short" vs "has a human confirmed this line").

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function PackOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState(null);
  const [stockByBundleId, setStockByBundleId] = useState({});

  // { [lineItemId]: number } — every line gets a default entry the moment the order loads, per
  // §5.4's "defaulting to the ordered quantity." touchedLines tracks which of those defaults a
  // human has actually engaged with this session (see the block comment above).
  const [packingQty, setPackingQty] = useState({});
  const [touchedLines, setTouchedLines] = useState(() => new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

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
        const defaults = {};
        orderData.lineItems.forEach((li) => {
          defaults[li.id] = li.qtySetsRequested;
        });
        setPackingQty(defaults);
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

  function adjustPacking(lineItemId, ordered, delta) {
    setPackingQty((prev) => {
      const current = prev[lineItemId] ?? ordered;
      // Hard clamp client-side (0..ordered) — the backend REJECTS an out-of-range value rather
      // than clamping it (04_API_SPEC.md), so the stepper itself must never be able to produce
      // one in the first place, not just rely on the server catching it after the fact.
      const next = Math.max(0, Math.min(ordered, current + delta));
      return { ...prev, [lineItemId]: next };
    });
    setTouchedLines((prev) => {
      const next = new Set(prev);
      next.add(lineItemId);
      return next;
    });
  }

  async function handleMarkPacked() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Every line, not just the touched ones — the backend requires full coverage
      // (04_API_SPEC.md's PATCH /:id/pack), so an untouched line submits at its own default
      // (== ordered), which is exactly the "assume a full pack unless staff says otherwise"
      // behavior this screen's defaults already imply.
      const lineItemsPayload = order.lineItems.map((li) => ({
        lineItemId: li.id,
        qtySetsPacked: packingQty[li.id] ?? li.qtySetsRequested,
      }));
      await packOrder(id, lineItemsPayload);
      const shortCount = order.lineItems.filter(
        (li) => (packingQty[li.id] ?? li.qtySetsRequested) < li.qtySetsRequested
      ).length;
      navigate('/pack-orders', {
        replace: true,
        state: {
          packedOutcome: { partyName: order.partyName, lineCount: order.lineItems.length, shortCount },
        },
      });
    } catch (err) {
      // Deliberately not resetting packingQty/touchedLines — someone else packing this order
      // first (ORDER_NOT_PLACED) must never cost staff their stepper entries. They see the real
      // message and either retry or back out via ScreenHeader. (Packing can no longer fail on
      // INSUFFICIENT_STOCK — it doesn't touch stock at all now; that moved to Bill.)
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

  const total = order.lineItems.length;
  const tally = order.lineItems.reduce(
    (acc, li) => {
      const qty = packingQty[li.id] ?? li.qtySetsRequested;
      const touched = touchedLines.has(li.id);
      if (!touched) acc.notStarted += 1;
      else if (qty === li.qtySetsRequested) acc.full += 1;
      else acc.short += 1;
      return acc;
    },
    { full: 0, short: 0, notStarted: 0 }
  );
  const tallyText =
    `${tally.full} of ${total} item${total === 1 ? '' : 's'} fully packed` +
    (tally.short > 0 ? ` · ${tally.short} short` : '') +
    (tally.notStarted > 0 ? ` · ${tally.notStarted} not started` : '');

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
                </div>
                <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {open && (
                <div className="accordion-body nested">
                  {group.lines.map((li) => {
                    const ordered = li.qtySetsRequested;
                    const qty = packingQty[li.id] ?? ordered;
                    const touched = touchedLines.has(li.id);
                    const isShort = qty < ordered;
                    const stockAvail = stockByBundleId[li.bundleId] ?? 0;

                    let StatusIcon = NotStartedIcon;
                    let statusClass = 'pack-line-status-not-started';
                    if (touched) {
                      if (isShort) {
                        StatusIcon = WarningTriangleIcon;
                        statusClass = 'pack-line-status-short';
                      } else {
                        StatusIcon = CheckCircleIcon;
                        statusClass = 'pack-line-status-full';
                      }
                    }

                    return (
                      <div key={li.id} className={`pack-line-row ${isShort ? 'pack-line-row-short' : ''}`}>
                        <div className="pack-line-row-header">
                          <span className="pack-line-color-chip">{li.colorName}</span>
                          <span className={statusClass}>
                            <StatusIcon size={18} />
                          </span>
                        </div>

                        <p className="pack-line-ordered">
                          {isShort
                            ? `Ordered: ${ordered} · Only ${stockAvail} in stock`
                            : `Ordered: ${pluralSets(ordered)}`}
                        </p>

                        <div className="pack-line-stepper-row">
                          <div className="stepper">
                            <button
                              type="button"
                              className="stepper-btn"
                              onClick={() => adjustPacking(li.id, ordered, -1)}
                              disabled={qty === 0 || submitting}
                              aria-label={`Decrease packed sets for ${li.colorName}`}
                            >
                              −
                            </button>
                            <span className="stepper-value">{qty}</span>
                            <button
                              type="button"
                              className="stepper-btn"
                              onClick={() => adjustPacking(li.id, ordered, 1)}
                              disabled={qty >= ordered || submitting}
                              aria-label={`Increase packed sets for ${li.colorName}`}
                            >
                              +
                            </button>
                          </div>
                          <span className="muted">In stock: {stockAvail}</span>
                        </div>

                        {isShort && (
                          <p className="pack-line-shortfall-note">
                            This will be recorded as a short-pack — the ordered quantity stays {ordered}; only how
                            much actually gets packed changes.
                          </p>
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
        <button type="button" className="btn-primary" onClick={handleMarkPacked} disabled={submitting}>
          {submitting ? 'Marking as packed…' : 'Mark as packed'}
        </button>
      </div>
    </div>
  );
}
