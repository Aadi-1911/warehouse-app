import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SendIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listOrders } from '../api/orders';

// Ship Order — order list. Same structure as PackOrderList/BillOrderList, scoped to BILLED.
//
// Any authenticated role, deliberately — rule 63 names Billed → Shipped as one of the two
// transitions staff DO trigger, same reasoning already applied to Pack Order. Unlike billing,
// this moves no stock and locks nothing; it records that the goods physically left.
//
// GET /api/orders?status=BILLED is the whole query: BILLED is the only status an order can be
// shipped from (the endpoint 409s on anything else).

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ShipOrderList() {
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [shippedOutcome, setShippedOutcome] = useState(() => location.state?.shippedOutcome ?? null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    listOrders({ status: 'BILLED' })
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
      {/* tone="tile-orange" (2026-08-27) matches Home's Ship Order tile exactly, per Aadi's
          confirmed tap-a-tile/land-on-that-colour continuity — was "accent" (blue). No same-page
          collision found: neither this screen nor ShipOrderDetail.jsx use orange/warning-amber
          anywhere else for genuine status meaning. */}
      <ScreenHeader icon={<SendIcon size={20} />} tone="tile-orange" title="Ship Order" />

      {shippedOutcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>Order shipped for {shippedOutcome.partyName}.</strong> This order is now complete.
          </p>
          <button type="button" className="link-button" onClick={() => setShippedOutcome(null)}>
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
        <p className="muted centered-empty-state">No billed orders waiting to ship.</p>
      ) : (
        orders.map((order) => (
          <Link key={order.id} to={`/ship-orders/${order.id}`} className="order-list-card">
            <div>
              <p className="order-list-card-party">{order.partyName}</p>
              <p className="muted">
                {order.lineItemCount} line{order.lineItemCount === 1 ? '' : 's'} · {formatCurrency(order.totalValue)}
              </p>
            </div>
            {/* Billed date — on this screen, "when did this become ready to ship" is what matters. */}
            <span className="muted order-list-card-date">
              {order.billedAt ? formatDate(order.billedAt) : formatDate(order.createdAt)}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
