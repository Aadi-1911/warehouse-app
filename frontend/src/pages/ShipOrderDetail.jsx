import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SendIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { getOrder, shipOrder } from '../api/orders';

// Ship Order — detail. Same structure as BillOrderDetail, read-only above the button.
//
// The confirm here is deliberately LIGHTER than Bill's: shipping moves no stock, locks nothing,
// and changes no quantity — the order was already locked at Billed. It records that the goods
// physically left, so the copy states that plainly instead of borrowing Bill's warning weight.
// Over-warning on a low-consequence action is its own failure: it trains people to dismiss the
// dialog that genuinely matters.

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function ShipOrderDetail() {
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

  async function handleConfirmShip() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await shipOrder(id);
      setConfirmOpen(false);
      navigate('/ship-orders', {
        replace: true,
        state: { shippedOutcome: { partyName: order.partyName } },
      });
    } catch (err) {
      // Realistically ORDER_NOT_BILLED — someone else shipped it first. Shown verbatim.
      setConfirmOpen(false);
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (orderStatus !== 'loaded') {
    return (
      <div className="page">
        {/* tone="tile-orange" (2026-08-27) — matches ShipOrderList.jsx's own header change and
            Home's Ship Order tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<SendIcon size={20} />} tone="tile-orange" title="Ship Order" />
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

  if (order.status !== 'BILLED') {
    return (
      <div className="page">
        {/* tone="tile-orange" (2026-08-27) — matches ShipOrderList.jsx's own header change and
            Home's Ship Order tile; see that file's comment for the full reasoning. */}
        <ScreenHeader icon={<SendIcon size={20} />} tone="tile-orange" title="Ship Order" />
        <p className="muted">{order.partyName}</p>
        <p className="error-banner" role="alert">
          This order can no longer be shipped — its status is now {order.status}.
        </p>
      </div>
    );
  }

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

  return (
    <div className="page">
      {/* tone="tile-orange" (2026-08-27) — matches ShipOrderList.jsx's own header change and
          Home's Ship Order tile; see that file's comment for the full reasoning. */}
      <ScreenHeader icon={<SendIcon size={20} />} tone="tile-orange" title="Ship Order" />
      <p className="muted">{order.partyName}</p>
      <span className="badge badge-accent">Billed</span>

      {submitError && (
        <p className="error-banner" role="alert">
          Could not mark this order as shipped: {submitError}
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
                  {group.lines.map((li) => (
                    <div key={li.id} className="bill-line-row">
                      <span className="pack-line-color-chip">{li.colorName}</span>
                      <span className="muted bill-line-qty">{pluralSets(li.qtySetsPacked)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky-action-bar">
        <p className="muted pack-order-tally">
          {pluralSets(totalPacked)} across {order.lineItems.length} line
          {order.lineItems.length === 1 ? '' : 's'}
        </p>
        <button type="button" className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={submitting}>
          {submitting ? 'Marking as shipped…' : 'Mark as shipped'}
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Mark this order as shipped?"
        body={`This records that ${order.partyName}'s order has left. Stock was already deducted when it was billed — nothing further changes.`}
        confirmLabel={submitting ? 'Marking…' : 'Mark as shipped'}
        tone="accent"
        onConfirm={handleConfirmShip}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
