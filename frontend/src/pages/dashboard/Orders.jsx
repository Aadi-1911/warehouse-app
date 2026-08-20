import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import ConfirmModal from '../../components/ConfirmModal';
import { listOrders, getOrder, billOrder } from '../../api/orders';
import { piecesPerSetFor } from '../../utils/piecesPerSet';
import { ORDER_STATUS_LABEL, ORDER_STATUS_BADGE, isOpenOrder } from '../../utils/orderStatus';

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

// STATUS_LABEL/STATUS_BADGE now live in utils/orderStatus.js — consolidated 2026-08-20 when the
// Parties page became a second dashboard surface needing the identical status→colour mapping.

// Month toggle (added 2026-08-20): the page splits into two sections.
//   1. "Open orders" — PLACED + PACKED, non-cancelled (utils/orderStatus.js's isOpenOrder,
//      mirroring dashboardController.js's own openOrders definition exactly). Always shown in
//      full, never month-filtered — an open order doesn't stop being open because its createdAt
//      falls outside whatever month happens to be selected below.
//   2. Everything else — BILLED, SHIPPED, and cancelled orders (any status) — filtered to one
//      selected month at a time via a dropdown, defaulting to the current calendar month.
// These two sets are exhaustive and non-overlapping by construction: rule 23 only allows
// isCancelled to be set while PLACED or PACKED, so a BILLED/SHIPPED order can never be cancelled,
// and isOpenOrder's own !isCancelled check means a cancelled PLACED/PACKED order falls out of
// section 1 and into section 2 instead of vanishing.
//
// Bucketing date per order (04_API_SPEC.md's own convention for status-scoped lists — "the date
// an order entered its current stage"):
//   - BILLED (not yet shipped): billedAt.
//   - SHIPPED: shippedAt.
//   - Cancelled: cancelledAt (server-resolved — see orderController.js's listOrders comment on
//     the adjustments select). Investigated before using this: a cancelled order may have been
//     cancelled straight from PLACED, with no packedAt/billedAt/shippedAt at all, so those can't
//     reliably date it. cancelOrder/cancelOrderLine both already write a real, timestamped
//     OrderAdjustment row for the cancellation event — reading that turned out to be a small
//     addition (one more nested Prisma select, not a new endpoint or schema change), so this uses
//     the real date rather than settling for an approximation.

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// The one date that actually matters for THIS order — whichever stage/event most recently placed
// it where it is. Section 1 (open orders) always uses createdAt instead (there's no stage-date to
// speak of yet), handled directly at the call site rather than here.
function bucketDateOf(order) {
  if (order.isCancelled) return order.cancelledAt;
  if (order.status === 'SHIPPED') return order.shippedAt;
  return order.billedAt; // BILLED — the only other status section 2 ever contains
}

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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

  // Independent of the fetched data — a pure calendar fact, computed once at mount, so it never
  // resets back to "this month" on a refetch (e.g. after billing an order) if the owner had
  // already navigated to a different month.
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());

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

  // One row's markup, shared by both sections — only the order and which date to show for it
  // differ (section 1 always shows createdAt; section 2 shows whichever stage/cancellation date
  // actually placed the order in the selected month).
  function renderOrderRow(order, dateIso) {
    const open = expanded.has(order.id);
    const detail = details[order.id];
    return (
      <div key={order.id} className={`dash-card accordion-section ${order.isCancelled ? 'dash-order-row-cancelled' : ''}`}>
        <div className="dash-order-row-header">
          <button type="button" className="accordion-header" onClick={() => toggleOrder(order.id)} aria-expanded={open}>
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
                  <span className={`badge ${ORDER_STATUS_BADGE[order.status]} dash-order-status-badge`}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                )}
              </div>
              <div className="accordion-subtitle">
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)} ·{' '}
                {formatDate(dateIso)}
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
            <button type="button" className="btn-primary btn-inline" onClick={() => setBillTarget(order)} disabled={billing}>
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

  const openOrders = orders.filter(isOpenOrder);
  const monthOrders = orders.filter((o) => !isOpenOrder(o));

  // Every month with a real order in it, plus the current month always (even if it'll render
  // empty — that's the "clean view" the dropdown is meant to give, per the task), most recent
  // first. Lexicographic sort on "YYYY-MM" strings is a correct chronological sort here.
  const monthKeys = new Set([currentMonthKey()]);
  monthOrders.forEach((o) => monthKeys.add(monthKeyOf(bucketDateOf(o))));
  const sortedMonthKeys = [...monthKeys].sort((a, b) => b.localeCompare(a));

  const visibleMonthOrders = monthOrders.filter((o) => monthKeyOf(bucketDateOf(o)) === selectedMonth);

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

      <section>
        <div className="dash-section-head">
          <h2 className="dash-section-title">Open orders</h2>
        </div>
        {openOrders.length === 0 ? (
          <p className="muted dash-empty">No open orders right now.</p>
        ) : (
          openOrders.map((order) => renderOrderRow(order, order.createdAt))
        )}
      </section>

      <section className="dash-section-spaced">
        <div className="dash-section-head">
          <h2 className="dash-section-title">Order history</h2>
          <div className="dash-month-picker">
            <label htmlFor="dash-orders-month" className="dash-month-picker-label">
              Month
            </label>
            <select id="dash-orders-month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
              {sortedMonthKeys.map((key) => (
                <option key={key} value={key}>
                  {monthLabelOf(key)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {visibleMonthOrders.length === 0 ? (
          <p className="muted dash-empty">No orders in {monthLabelOf(selectedMonth)}.</p>
        ) : (
          visibleMonthOrders.map((order) => renderOrderRow(order, bucketDateOf(order)))
        )}
      </section>

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
