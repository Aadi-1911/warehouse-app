import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvoiceIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import { getOrder, billOrder, cancelOrderLine, cancelOrder } from '../api/orders';
import { listStock } from '../api/stock';
import { piecesPerSetFor } from '../utils/piecesPerSet';
import { preBillingTotal, computeBillingAmounts } from '../utils/orderBilling';

// Bill Orders — detail. Mirrors PackOrderDetail.jsx's structure (accordion grouped by article,
// sticky action bar, confirm before the mutation) but is entirely READ-ONLY above the button:
// billing commits exactly what packing already counted, so there is nothing to edit here. Any
// discrepancy between ordered and packed was settled at pack time and is shown, not adjustable.
//
// This is the ONE irreversible action in the whole order lifecycle — it deducts real stock FIFO
// across locations and applies rule 23's hard lock (no further edits to this order, ever). The
// confirm copy below is deliberately weightier than every other ConfirmModal in this app for
// that reason; it names both consequences explicitly rather than asking a generic "are you sure?"
//
// --- On the up-front stock check ---
// Real current stock is fetched on load and compared against each line's qtySetsPacked, so a line
// that CAN'T be billed is flagged the moment the screen opens rather than only after tapping the
// button. This is purely INFORMATIONAL: the backend's own INSUFFICIENT_STOCK check at bill time is
// still the real enforcement and is unchanged. Stock can genuinely move between this page loading
// and a real bill attempt (another order bills first, a transfer runs), so that error path is
// still handled here — this check just makes it the rare surprise instead of the primary way
// anyone discovers a shortage.
//
// A blocked line uses a DANGER tint, deliberately distinct from Pack Order's amber shortfall
// tint. Those are different severities and shouldn't look alike: amber there means "we proceeded
// with less than ordered," red here means "this cannot proceed at all.""

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

// utils/piecesPerSet.js's piecesPerSetFor expects a product-shaped { isKids, sizes } object;
// getOrder() returns those flattened onto the line item itself (productIsKids/productSizes), so
// this adapts the shape at the one call site below rather than changing the shared function.
function piecesPerSetForLine(li) {
  return piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes });
}

export default function BillOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // This screen is already OWNER-only at the route, so this is belt-and-braces rather than the
  // real gate (which is requireRole('OWNER') on the API).
  const { user } = useAuth();
  const canCancel = user.role === 'OWNER';

  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState(null);

  // Real stock, summed by bundleId — same unfiltered listStock() + client-side grouping pattern
  // PackOrderDetail.jsx already uses (see its own comment on why the full list is fetched rather
  // than one article's worth), reused here rather than rebuilt.
  const [stockByBundleId, setStockByBundleId] = useState({});

  const [expandedArticles, setExpandedArticles] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Discount/GST questions (added 2026-08-25, rule 101) — live-computed inside the same "Bill
  // this order?" confirm flow, not a separate step. Percent fields are strings (not numbers)
  // because a controlled number input needs to represent "nothing typed yet" as `''`, distinct
  // from `0` — the same idle/loaded discipline this project applies to async status elsewhere,
  // applied here to "not yet a real percent."
  const [discountApplicable, setDiscountApplicable] = useState(false);
  const [discountPercent, setDiscountPercent] = useState('');
  const [gstApplicable, setGstApplicable] = useState(false);
  const [gstPercent, setGstPercent] = useState('');

  // Same single-target pattern as PackOrderDetail — { kind: 'line', line } or { kind: 'order' }.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setOrderStatus('loading');
    setOrderError(null);
    Promise.all([getOrder(id), listStock()])
      .then(([data, stockRows]) => {
        if (cancelled) return;
        setOrder(data);
        const totals = {};
        stockRows.forEach((r) => {
          totals[r.bundleId] = (totals[r.bundleId] ?? 0) + r.qtySets;
        });
        setStockByBundleId(totals);
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

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function handleConfirmCancel() {
    setCancelError(null);
    setCancelling(true);
    try {
      if (cancelTarget.kind === 'order') {
        await cancelOrder(id);
        setCancelTarget(null);
        navigate('/bill-orders', { replace: true, state: { cancelledOutcome: { partyName: order.partyName } } });
        return;
      }
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

  async function handleConfirmBill() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Only the raw applicable/percent inputs go over the wire — the server independently
      // recomputes preTaxAmount/finalAmount/actualPayable from live order data and stores those;
      // nothing computed for the preview below is ever sent as-is.
      await billOrder(id, {
        discountApplicable,
        discountPercent: discountApplicable ? Number(discountPercent) : null,
        gstApplicable,
        gstPercent: gstApplicable ? Number(gstPercent) : null,
      });
      setConfirmOpen(false);
      navigate('/bill-orders', {
        replace: true,
        state: { billedOutcome: { partyName: order.partyName } },
      });
    } catch (err) {
      // The two realistic failures both carry a real backend message worth showing verbatim:
      // INSUFFICIENT_STOCK (stock moved between packing and billing) and ORDER_NOT_PACKED
      // (someone else billed it first). Discount/GST inputs are deliberately NOT cleared on this
      // path — a real, valid entry the owner already typed shouldn't vanish just because billing
      // failed for an unrelated stock reason; they can retry without re-entering it.
      setConfirmOpen(false);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Discount/GST inputs reset when the confirm dialog is dismissed WITHOUT billing — re-opening
  // it (for this order or, after navigating away, a different one) always starts from a clean
  // "no discount, no GST" state rather than silently carrying over a half-filled previous attempt.
  function handleCancelBillConfirm() {
    setConfirmOpen(false);
    setDiscountApplicable(false);
    setDiscountPercent('');
    setGstApplicable(false);
    setGstPercent('');
  }

  if (orderStatus !== 'loaded') {
    return (
      <div className="page">
        {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
            Home's Bill Orders tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
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

  // A stale list row or a direct link could point at an order someone else already billed —
  // caught here, before the button is even offered, rather than only at submit time.
  if (order.status !== 'PACKED') {
    return (
      <div className="page">
        {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
            Home's Bill Orders tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
        <p className="muted">{order.partyName}</p>
        <p className="error-banner" role="alert">
          This order can no longer be billed — its status is now {order.status}.
        </p>
      </div>
    );
  }

  // Grouped by article, same shape PackOrderDetail and New Order's summary both use. `total` is
  // this article's value across its non-cancelled lines only — qtySetsPacked, not
  // qtySetsRequested, because this is the PRE-BILLING screen and packed quantity is the
  // authoritative figure before billing (04_API_SPEC.md), exactly for a short-packed line like
  // this. A cancelled line contributes nothing, same reasoning as listOrders' totalValue fix.
  const groups = order.lineItems
    .reduce((acc, li) => {
      let group = acc.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [], total: 0 };
        acc.push(group);
      }
      group.lines.push(li);
      if (!li.isCancelled) {
        group.total += li.qtySetsPacked * piecesPerSetForLine(li) * Number(li.priceAtOrder);
      }
      return acc;
    }, [])
    .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

  const liveLines = order.lineItems.filter((li) => !li.isCancelled);
  const cancelledCount = order.lineItems.length - liveLines.length;
  const totalPacked = liveLines.reduce((sum, li) => sum + li.qtySetsPacked, 0);
  const shortLines = liveLines.filter((li) => li.qtySetsPacked < li.qtySetsRequested).length;

  // A line is BLOCKED when real current stock can't cover what was packed — the same comparison
  // billOrder's own pre-check makes server-side. Computed here once and reused for the row tint,
  // the collapsed-header indicator, and the button's disabled state, so all three can never
  // disagree with each other.
  const availableFor = (li) => stockByBundleId[li.bundleId] ?? 0;
  // !li.isCancelled comes FIRST deliberately: a cancelled line is never billed, so it can never
  // block billing either. Cancelling a line whose stock ran short is precisely how an owner
  // unblocks the rest of the order, and this is the line of code that makes that true.
  const isBlocked = (li) => !li.isCancelled && li.qtySetsPacked > 0 && availableFor(li) < li.qtySetsPacked;
  const blockedLines = order.lineItems.filter(isBlocked);

  // Live discount/GST preview (rule 101) — computed from the exact same liveLines/qtySetsPacked
  // basis as `groups` above (utils/orderBilling.js, shared with dashboard/Orders.jsx so both
  // real billing entry points can never disagree on the same order). Purely a client-side
  // preview: billOrder() independently recomputes and stores the authoritative figures.
  const preTaxAmount = preBillingTotal(liveLines);
  const { discountAmount, finalAmount, gstAmount, actualPayable, hasDiscount, hasGst } = computeBillingAmounts({
    preTaxAmount,
    discountApplicable,
    discountPercent,
    gstApplicable,
    gstPercent,
  });
  // Blocks confirming with a half-answered question — the checkbox says "yes, apply a discount"
  // but no usable percent has been typed yet. Same guard shape as blockedLines.length above:
  // the trigger button and the modal's own confirm button share this so an owner can't get from
  // a checked-but-empty state into the modal expecting to just press through it.
  const billingInputIncomplete = (discountApplicable && !hasDiscount) || (gstApplicable && !hasGst);

  return (
    <div className="page">
      {/* tone="tile-red" (2026-08-27) — matches BillOrderList.jsx's own header change and
          Home's Bill Orders tile; see that file's comment for the full reasoning. */}
      <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />
      <p className="muted">{order.partyName}</p>
      <span className="badge badge-warning">Packed</span>

      {submitError && (
        <p className="error-banner" role="alert">
          Could not bill this order: {submitError}
        </p>
      )}

      {cancelError && (
        <p className="error-banner" role="alert">
          Could not cancel: {cancelError}
        </p>
      )}

      <div className="card">
        {groups.map((group) => {
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
                    {/* One total per article, not per colour line — the sum across this
                        article's non-cancelled lines, at the header level only. */}
                    <span className="muted"> · {formatCurrency(group.total)}</span>
                  </div>
                  {/* Surfaced on the COLLAPSED header specifically, so a blocked line doesn't
                      require expanding every article one by one to find. */}
                  {group.lines.some(isBlocked) && (
                    <div className="accordion-subtitle">
                      <span className="badge badge-danger accordion-low-badge">
                        {group.lines.filter(isBlocked).length} can't be billed
                      </span>
                    </div>
                  )}
                </div>
                <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {open && (
                <div className="accordion-body nested">
                  {group.lines.map((li) => {
                    // Kept visible, struck through — same "never hard-delete" spirit the rest of
                    // this app applies to archived records.
                    if (li.isCancelled) {
                      return (
                        <div key={li.id} className="bill-line-row bill-line-row-cancelled">
                          <div className="bill-line-main">
                            <span className="pack-line-color-chip">{li.colorName}</span>
                            <span className="badge badge-danger">Cancelled</span>
                          </div>
                        </div>
                      );
                    }
                    const isShort = li.qtySetsPacked < li.qtySetsRequested;
                    const blocked = isBlocked(li);
                    return (
                      <div key={li.id} className={`bill-line-row ${blocked ? 'bill-line-row-blocked' : ''}`}>
                        <div className="bill-line-main">
                          <span className="pack-line-color-chip">{li.colorName}</span>
                          <span className="muted bill-line-qty">
                            {pluralSets(li.qtySetsPacked)}
                            {/* Shown only when they differ, so the owner can see exactly what
                                they're committing to versus what was originally ordered. */}
                            {isShort && (
                              <span className="bill-line-short"> (of {li.qtySetsRequested} ordered)</span>
                            )}
                          </span>
                        </div>
                        {blocked && (
                          <p className="bill-line-blocked-note">
                            Only {availableFor(li)} in stock — cannot bill this line yet.
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
        <p className="muted pack-order-tally">
          {pluralSets(totalPacked)} packed across {order.lineItems.length} line
          {order.lineItems.length === 1 ? '' : 's'}
          {shortLines > 0 ? ` · ${shortLines} short-packed` : ''}
          {cancelledCount > 0 ? ` · ${cancelledCount} cancelled` : ''}
        </p>
        {/* The note sits ABOVE the disabled button, not inside a tooltip or only on the rows —
            a disabled control with no visible reason is its own usability failure. */}
        {blockedLines.length > 0 && (
          <p className="bill-blocked-note">
            {blockedLines.length} line{blockedLines.length === 1 ? "" : "s"} don't have enough stock to bill
            yet — receive stock or adjust the order first.
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={() => setConfirmOpen(true)}
          disabled={submitting || blockedLines.length > 0}
        >
          {submitting ? 'Billing…' : 'Bill this order'}
        </button>
        {/* Separated from the primary action for the same reason as on Pack Order: cancelling
            the order and billing it are opposite outcomes and must not sit adjacent as peers. */}
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

      <ConfirmModal
        open={!!cancelTarget}
        title={cancelTarget?.kind === 'order' ? 'Cancel this whole order?' : 'Cancel this line?'}
        body={
          cancelTarget?.kind === 'order'
            ? `${order.partyName}'s entire order will be cancelled and removed from the billing list. The lines stay on record — nothing is deleted — but the order can't be billed or dispatched afterwards.`
            : `${cancelTarget?.line.colorName} will be cancelled and won't be billed. No stock is deducted for it. The packed quantity stays on record; only the line is marked cancelled.`
        }
        confirmLabel={cancelling ? 'Cancelling…' : cancelTarget?.kind === 'order' ? 'Cancel whole order' : 'Cancel line'}
        tone="danger"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Deliberately heavier copy than any other confirm in this app — this is the only action
          in the whole lifecycle that can't be undone, and it does two separate irreversible
          things. Both are named outright rather than summarised as "are you sure?"

          Discount/GST questions (rule 101) live inside this SAME confirm flow via ConfirmModal's
          `children` — not a second dialog — so the owner answers them right where they're
          already committing to bill, with the real rupee impact visible before they press
          confirm, not only afterward. */}
      <ConfirmModal
        open={confirmOpen}
        title="Bill this order? This cannot be undone."
        body={`This immediately deducts ${pluralSets(totalPacked)} from live stock, and permanently locks ${order.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`}
        confirmLabel={submitting ? 'Billing…' : 'Bill and lock order'}
        tone="danger"
        onConfirm={handleConfirmBill}
        onCancel={handleCancelBillConfirm}
        confirmDisabled={submitting || billingInputIncomplete}
      >
        <div className="bill-pricing-questions">
          <p className="muted bill-pricing-pretax">Order total: {formatCurrency(preTaxAmount)}</p>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={discountApplicable}
              onChange={(e) => setDiscountApplicable(e.target.checked)}
            />
            Apply a discount?
          </label>
          {discountApplicable && (
            <div className="field bill-pricing-percent-field">
              <span className="field-label">Discount %</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="e.g. 5"
                autoFocus
              />
            </div>
          )}
          {hasDiscount && (
            <p className="bill-pricing-line">
              −{formatCurrency(discountAmount)} discount → {formatCurrency(finalAmount)}
            </p>
          )}

          <label className="checkbox-field">
            <input type="checkbox" checked={gstApplicable} onChange={(e) => setGstApplicable(e.target.checked)} />
            Apply GST?
          </label>
          {gstApplicable && (
            <div className="field bill-pricing-percent-field">
              <span className="field-label">GST %</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                placeholder="e.g. 5"
                autoFocus
              />
            </div>
          )}
          {hasGst && <p className="bill-pricing-line">+{formatCurrency(gstAmount)} GST</p>}

          <p className="bill-pricing-final">Total to bill: {formatCurrency(actualPayable)}</p>
        </div>
      </ConfirmModal>
    </div>
  );
}
