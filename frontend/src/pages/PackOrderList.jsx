import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PackageIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listOrders } from '../api/orders';

// Pack Order — order list, 07_UI_DESIGN_BRIEF.md §5.4 (Pack List view only; the flat Tally
// checklist view mentioned in the "— updated" section is a separate follow-up, out of scope
// here). Reachable by any authenticated role (rule 63: staff is the primary user for pack/ship).
//
// GET /api/orders?status=PLACED is the whole query — PLACED is the only status a line item can
// still be packed from (Pack List detail 409s on anything else), so there's no client-side
// filtering to do on top of what the backend already scopes.

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function PackOrderList() {
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  // Explicit status, not a bare boolean — same rule this app applies everywhere data loads on
  // mount, so an empty list can never be confused with "hasn't fetched yet."
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Captured once, from router state, the moment this screen first renders — Pack List detail
  // leaves this behind via navigate(..., { state }) after a successful "Mark as packed," so
  // returning here (this task's own requirement) comes with a real, visible confirmation
  // instead of a silent redirect. A useState initializer (not a useEffect) so it can't
  // re-trigger if location.state happens to change identity on a later render.
  const [packedOutcome, setPackedOutcome] = useState(() => location.state?.packedOutcome ?? null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    listOrders({ status: 'PLACED' })
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
      <ScreenHeader icon={<PackageIcon size={20} />} tone="warning" title="Pack Order" />

      {packedOutcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>Order packed for {packedOutcome.partyName}.</strong>{' '}
            {packedOutcome.shortCount > 0
              ? `${packedOutcome.lineCount - packedOutcome.shortCount} of ${packedOutcome.lineCount} line${
                  packedOutcome.lineCount === 1 ? '' : 's'
                } fully packed, ${packedOutcome.shortCount} short.`
              : `All ${packedOutcome.lineCount} line${packedOutcome.lineCount === 1 ? '' : 's'} fully packed.`}
          </p>
          <button type="button" className="link-button" onClick={() => setPackedOutcome(null)}>
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
        <p className="muted centered-empty-state">No orders waiting to be packed.</p>
      ) : (
        orders.map((order) => (
          <Link key={order.id} to={`/pack-orders/${order.id}`} className="order-list-card">
            <div>
              <p className="order-list-card-party">{order.partyName}</p>
              <p className="muted">
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)}
              </p>
            </div>
            <span className="muted order-list-card-date">{formatDate(order.createdAt)}</span>
          </Link>
        ))
      )}
    </div>
  );
}
