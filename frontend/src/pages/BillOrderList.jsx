import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { InvoiceIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listOrders } from '../api/orders';

// Bill Orders — order list. Structurally the same screen as PackOrderList.jsx (list of orders at
// one status, tap a row to open its detail route), differing only in which status it scopes to
// and which date it surfaces.
//
// OWNER ONLY, at the route level (App.jsx) and again at the API (PATCH /:id/bill is gated by
// requireRole('OWNER')). Rule 63 states plainly that "... → Billed" is owner-only and must never
// be offered to STAFF — and this is also the transition that moves real inventory.
//
// GET /api/orders?status=PACKED is the whole query: PACKED is the only status an order can be
// billed from (the endpoint 409s on anything else), so there's no client-side filtering on top.

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function BillOrderList() {
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  // Explicit status, not a bare boolean — so an empty list can never be confused with
  // "hasn't fetched yet."
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Left behind by BillOrderDetail via navigate(..., { state }) after a successful bill, so
  // returning here comes with a real confirmation rather than a silent redirect. A useState
  // initializer (not useEffect) so it can't re-fire if location.state changes identity later.
  const [billedOutcome, setBilledOutcome] = useState(() => location.state?.billedOutcome ?? null);
  // Left behind by the detail screen after a whole-order cancel, which redirects here because a
  // cancelled order no longer belongs on this worklist.
  const [cancelledOutcome, setCancelledOutcome] = useState(() => location.state?.cancelledOutcome ?? null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    listOrders({ status: 'PACKED' })
      .then((list) => {
        if (!cancelled) setOrders(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      {/* tone="tile-red" (2026-08-27) matches Home's Bill Orders tile exactly, per Aadi's
          confirmed tap-a-tile/land-on-that-colour continuity — was "accent" (blue). Flagged, not
          silently touched: BillOrderDetail.jsx's own "Cancelled"/"can't be billed" badges and its
          cancel button/confirm modal still genuinely mean danger and still use --danger-* red —
          two different reds now exist across this one flow, reported to Aadi rather than decided
          here. See LEARNING_LOG.md. */}
      <ScreenHeader icon={<InvoiceIcon size={20} />} tone="tile-red" title="Bill Orders" />

      {billedOutcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>Order billed for {billedOutcome.partyName}.</strong> Stock has been deducted and this
            order is now locked — it can no longer be changed. It's ready to ship.
          </p>
          <button type="button" className="link-button" onClick={() => setBilledOutcome(null)}>
            OK
          </button>
        </div>
      )}

      {cancelledOutcome && (
        <div className="result-banner result-banner-warning">
          <p>
            <strong>Order cancelled for {cancelledOutcome.partyName}.</strong> It's been removed from the
            billing list. Its lines stay on record and it still appears in History.
          </p>
          <button type="button" className="link-button" onClick={() => setCancelledOutcome(null)}>
            OK
          </button>
        </div>
      )}

      {error && (
        <p className="error-banner" role="alert">
          Could not load orders: {error}
        </p>
      )}

      {status !== 'loaded' ? (
        <p className="muted centered-empty-state">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="muted centered-empty-state">No packed orders waiting to be billed.</p>
      ) : (
        orders.map((order) => (
          <Link key={order.id} to={`/bill-orders/${order.id}`} className="order-list-card">
            <div>
              <p className="order-list-card-party">{order.partyName}</p>
              <p className="muted">
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)}
              </p>
            </div>
            {/* Packed date, not created date — on this screen "when was this made ready to bill"
                is the useful figure. packedAt is guaranteed non-null here because the list is
                scoped to status=PACKED, but the fallback keeps a bad row from rendering blank. */}
            <span className="muted order-list-card-date">
              {order.packedAt ? formatDate(order.packedAt) : formatDate(order.createdAt)}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
