import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { listOrders, getOrder, billOrder } from '../../api/orders';
import { piecesPerSetFor } from '../../utils/piecesPerSet';

// Owner Dashboard — Orders (07_UI_DESIGN_BRIEF.md §8's "Orders page" section).
//
// Accordion, one row per order — GET /api/orders unfiltered (no date/party filter UI; the design
// brief doesn't document one, and inventing one wasn't asked for). That endpoint's totalValue is
// already correct as of the recent pricing-fix tasks (per-piece pricing, cancelled lines
// excluded) — this page trusts it rather than recomputing its own version.
//
// Expanding a row lazily fetches full line detail via GET /api/orders/:id on first expand, cached
// per order afterward — the scalable choice per the task brief, even though current order volume
// (3 rows) would make an upfront fetch-everything approach work just as well today.
//
// "Mark billed" calls the SAME billOrder() the mobile Bill Order screen already uses — no second
// billing code path. That's what makes the History entry it writes (authored as the owner) come
// for free here rather than needing its own implementation.
//
// isCancelled is an ORDER-level flag, independent of status (rule: cancelling never rewrites
// status — see cancelOrder). GET /api/orders' unfiltered response didn't select it until this was
// found and fixed 2026-08-20: a cancelled order at status PACKED rendered identically to an active
// one here, "Mark billed" included, even though billOrder() itself already rejects it server-side
// (409 ORDER_CANCELLED) — confirmed that guard exists before treating this as frontend-only.

const STATUS_LABEL = { PLACED: 'Placed', PACKED: 'Packed', BILLED: 'Billed', SHIPPED: 'Shipped' };
// Rule mapping per 07_UI_DESIGN_BRIEF.md §3.4's token table: Placed/Packed share the
// Warning/Pack role, Billed/Shipped share the Accent/Ship/Billed role — same pairing already
// visible in PackOrderDetail ("Placed" badge-warning), BillOrderDetail ("Packed" badge-warning)
// and ShipOrderDetail ("Billed" badge-accent).
const STATUS_BADGE = { PLACED: 'badge-warning', PACKED: 'badge-warning', BILLED: 'badge-accent', SHIPPED: 'badge-accent' };

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

// A line's value is qtySetsRequested-based (not qtySetsPacked), matching the basis GET
// /api/orders' own totalValue already uses for the row-level figure this page shows collapsed —
// so a line's value and the order's total agree, rather than mixing two different bases on one
// screen. (BillOrderDetail.jsx uses qtySetsPacked instead, but that's the pre-billing screen
// specifically showing what will actually be committed — a different question than this one.)
function lineValue(li) {
  if (li.isCancelled) return 0;
  return li.qtySetsRequested * piecesPerSetFor({ isKids: li.productIsKids, sizes: li.productSizes }) * Number(li.priceAtOrder);
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [ordersStatus, setOrdersStatus] = useState('idle');
  const [ordersError, setOrdersError] = useState(null);

  // Multiple rows can be open at once — same convention PackOrderDetail/BillOrderDetail use for
  // their own article accordions (a Set of expanded ids, not one active id).
  const [expanded, setExpanded] = useState(() => new Set());

  // Per-order cache of the lazily-fetched detail: { [orderId]: { status: 'loading'|'loaded'|'error', order, error } }.
  const [details, setDetails] = useState({});

  const [billTarget, setBillTarget] = useState(null); // the order row being billed, or null
  const [billing, setBilling] = useState(false);
  const [billError, setBillError] = useState(null);

  function loadOrders() {
    setOrdersStatus('loading');
    setOrdersError(null);
    listOrders()
      .then((list) => setOrders(list))
      .catch((err) => setOrdersError(err.message))
      .finally(() => setOrdersStatus('loaded'));
  }

  useEffect(() => {
    loadOrders();
  }, []);

  function toggleOrder(orderId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
        return next;
      }
      next.add(orderId);
      return next;
    });

    // Fetch on first expand only — a cached or in-flight entry means there's nothing to do.
    setDetails((prev) => {
      if (prev[orderId]) return prev;
      getOrder(orderId)
        .then((order) => setDetails((d) => ({ ...d, [orderId]: { status: 'loaded', order } })))
        .catch((err) => setDetails((d) => ({ ...d, [orderId]: { status: 'error', error: err.message } })));
      return { ...prev, [orderId]: { status: 'loading' } };
    });
  }

  async function handleConfirmBill() {
    const target = billTarget;
    setBillError(null);
    setBilling(true);
    try {
      const updated = await billOrder(target.id);
      setBillTarget(null);
      // Reflect the new status immediately in both the collapsed row (from the list refetch,
      // which also picks up any totalValue drift) and the cached detail, so an already-expanded
      // row doesn't show a stale PACKED state next to a Billed badge.
      loadOrders();
      setDetails((prev) => ({ ...prev, [target.id]: { status: 'loaded', order: updated } }));
    } catch (err) {
      // Same two realistic failures BillOrderDetail's own confirm handles: INSUFFICIENT_STOCK
      // (stock moved since this list loaded) and ORDER_NOT_PACKED (billed from elsewhere first).
      setBillTarget(null);
      setBillError(err.message);
    } finally {
      setBilling(false);
    }
  }

  if (ordersStatus !== 'loaded') {
    return (
      <>
        {ordersError && (
          <p className="error-banner" role="alert">
            Could not load orders: {ordersError}
          </p>
        )}
        {!ordersError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {ordersError && (
        <p className="error-banner" role="alert">
          Could not refresh orders: {ordersError}
        </p>
      )}
      {billError && (
        <p className="error-banner" role="alert">
          Could not mark that order billed: {billError}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="muted dash-empty">No orders yet.</p>
      ) : (
        orders.map((order) => {
          const open = expanded.has(order.id);
          const detail = details[order.id];
          return (
            <div key={order.id} className={`dash-card accordion-section ${order.isCancelled ? 'dash-order-row-cancelled' : ''}`}>
              <div className="dash-order-row-header">
                <button
                  type="button"
                  className="accordion-header"
                  onClick={() => toggleOrder(order.id)}
                  aria-expanded={open}
                >
                  <div className="accordion-header-text">
                    <div className="accordion-title-sm">
                      <span className="dash-order-party-name">{order.partyName}</span>
                      {/* A cancelled order always reads as Cancelled here, regardless of the
                          status it was cancelled AT — the underlying status (kept, never
                          rewritten by cancellation — see cancelOrder) is no longer the useful
                          fact once nothing about this order can move forward. */}
                      {order.isCancelled ? (
                        <span className="badge badge-danger dash-order-status-badge">Cancelled</span>
                      ) : (
                        <span className={`badge ${STATUS_BADGE[order.status]} dash-order-status-badge`}>
                          {STATUS_LABEL[order.status]}
                        </span>
                      )}
                    </div>
                    <div className="accordion-subtitle">
                      {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)}
                    </div>
                  </div>
                  <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
                </button>

                {/* Only on PACKED, non-cancelled orders — the one owner-initiated status
                    transition (rule 70). A cancelled order can sit at status PACKED forever
                    (cancellation never rewrites status, see cancelOrder), so status alone isn't
                    enough to decide this — billOrder() itself already 409s on a cancelled order
                    (ORDER_CANCELLED), but the button shouldn't be offered in the first place. */}
                {order.status === 'PACKED' && !order.isCancelled && (
                  <button
                    type="button"
                    className="btn-primary btn-inline"
                    onClick={() => setBillTarget(order)}
                    disabled={billing}
                  >
                    Mark billed
                  </button>
                )}
              </div>

              {open && (
                <div className="accordion-body">
                  {!detail || detail.status === 'loading' ? (
                    <p className="muted dash-empty">Loading…</p>
                  ) : detail.status === 'error' ? (
                    <p className="error-banner" role="alert">
                      Could not load this order's lines: {detail.error}
                    </p>
                  ) : (
                    detail.order.lineItems.map((li) => (
                      // Cancelled lines stay visible, struck through — same "never hide, never
                      // hard-delete" convention Bill/Pack Order detail already use, not filtered
                      // out here either.
                      <div key={li.id} className={`dash-order-line ${li.isCancelled ? 'dash-order-line-cancelled' : ''}`}>
                        <div className="dash-order-line-main">
                          <span className="dash-order-line-label">
                            {li.productArticleNo} — {li.productName} · {li.colorName}
                          </span>
                          {li.isCancelled && <span className="badge badge-danger">Cancelled</span>}
                        </div>
                        {!li.isCancelled && (
                          <span className="muted dash-order-line-meta">
                            Ordered: {pluralSets(li.qtySetsRequested)} · Packed:{' '}
                            {detail.order.status === 'PLACED' ? 'Not yet packed' : pluralSets(li.qtySetsPacked)} ·{' '}
                            {formatCurrency(lineValue(li))}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Deliberately the SAME weight of copy BillOrderDetail's own confirm uses for this exact
          action — it's the one irreversible step in the order lifecycle regardless of which
          screen triggers it. */}
      <ConfirmModal
        open={!!billTarget}
        title="Bill this order? This cannot be undone."
        body={
          billTarget
            ? `This immediately deducts real stock and permanently locks ${billTarget.partyName}'s order — no quantity, price or packing change is possible after this, ever. There is no way to reverse it.`
            : ''
        }
        confirmLabel={billing ? 'Billing…' : 'Bill and lock order'}
        tone="danger"
        onConfirm={handleConfirmBill}
        onCancel={() => setBillTarget(null)}
      />
    </>
  );
}
