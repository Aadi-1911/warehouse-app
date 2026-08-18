import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvoiceIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { getOrder, billOrder } from '../api/orders';
import { listStock } from '../api/stock';

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

export default function BillOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

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

  async function handleConfirmBill() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await billOrder(id);
      setConfirmOpen(false);
      navigate('/bill-orders', {
        replace: true,
        state: { billedOutcome: { partyName: order.partyName } },
      });
    } catch (err) {
      // The two realistic failures both carry a real backend message worth showing verbatim:
      // INSUFFICIENT_STOCK (stock moved between packing and billing) and ORDER_NOT_PACKED
      // (someone else billed it first). Neither loses anything — nothing here is user-entered.
      setConfirmOpen(false);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (orderStatus !== 'loaded') {
    return (
      <div className="page">
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="accent" title="Bill Orders" />
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
        <ScreenHeader icon={<InvoiceIcon size={20} />} tone="accent" title="Bill Orders" />
        <p className="muted">{order.partyName}</p>
        <p className="error-banner" role="alert">
          This order can no longer be billed — its status is now {order.status}.
        </p>
      </div>
    );
  }

  // Grouped by article, same shape PackOrderDetail and New Order's summary both use.
  const groups = order.lineItems
    .reduce((acc, li) => {
      let group = acc.find((g) => g.productId === li.productId);
      if (!group) {
        group = { productId: li.productId, articleNo: li.productArticleNo, productName: li.productName, lines: [] };
        acc.push(group);
      }
      group.lines.push(li);
      return acc;
    }, [])
    .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

  const totalPacked = order.lineItems.reduce((sum, li) => sum + li.qtySetsPacked, 0);
  const shortLines = order.lineItems.filter((li) => li.qtySetsPacked < li.qtySetsRequested).length;

  // A line is BLOCKED when real current stock can't cover what was packed — the same comparison
  // billOrder's own pre-check makes server-side. Computed here once and reused for the row tint,
  // the collapsed-header indicator, and the button's disabled state, so all three can never
  // disagree with each other.
  const availableFor = (li) => stockByBundleId[li.bundleId] ?? 0;
  const isBlocked = (li) => li.qtySetsPacked > 0 && availableFor(li) < li.qtySetsPacked;
  const blockedLines = order.lineItems.filter(isBlocked);

  return (
    <div className="page">
      <ScreenHeader icon={<InvoiceIcon size={20} />} tone="accent" title="Bill Orders" />
      <p className="muted">{order.partyName}</p>
      <span className="badge badge-warning">Packed</span>

      {submitError && (
        <p className="error-banner" role="alert">
          Could not bill this order: {submitError}
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
      </div>

      {/* Deliberately heavier copy than any other confirm in this app — this is the only action
          in the whole lifecycle that can't be undone, and it does two separate irreversible
          things. Both are named outright rather than summarised as "are you sure?" */}
      <ConfirmModal
        open={confirmOpen}
        title="Bill this order? This cannot be undone."
        body={`This immediately deducts ${pluralSets(totalPacked)} from live stock, and permanently locks ${order.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`}
        confirmLabel={submitting ? 'Billing…' : 'Bill and lock order'}
        tone="danger"
        onConfirm={handleConfirmBill}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
