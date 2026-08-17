import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InvoiceIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { getOrder, billOrder } from '../api/orders';

// Bill Orders — detail. Mirrors PackOrderDetail.jsx's structure (accordion grouped by article,
// sticky action bar, confirm before the mutation) but is entirely READ-ONLY above the button:
// billing commits exactly what packing already counted, so there is nothing to edit here. Any
// discrepancy between ordered and packed was settled at pack time and is shown, not adjustable.
//
// This is the ONE irreversible action in the whole order lifecycle — it deducts real stock FIFO
// across locations and applies rule 23's hard lock (no further edits to this order, ever). The
// confirm copy below is deliberately weightier than every other ConfirmModal in this app for
// that reason; it names both consequences explicitly rather than asking a generic "are you sure?"

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function BillOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [orderStatus, setOrderStatus] = useState('idle');
  const [orderError, setOrderError] = useState(null);

  const [expandedArticles, setExpandedArticles] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setOrderStatus('loading');
    setOrderError(null);
    getOrder(id)
      .then((data) => {
        if (!cancelled) setOrder(data);
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
                </div>
                <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {open && (
                <div className="accordion-body nested">
                  {group.lines.map((li) => {
                    const isShort = li.qtySetsPacked < li.qtySetsRequested;
                    return (
                      <div key={li.id} className="bill-line-row">
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
        <button type="button" className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={submitting}>
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
