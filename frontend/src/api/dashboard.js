import { apiFetch } from './client';

// GET /api/dashboard/overview -> { stockValue, setsInStock, bundlesWithStock, piecesInStock,
// openOrdersCount, openOrdersValue, lowStockCount, lowStockThreshold, revenue, revenuePeriod,
// revenueLabel }
//
// OWNER only — the response is derived from costPrice, so a STAFF token gets a real 403 from the
// server, not just a hidden screen.
//
// `revenuePeriod` is 'month' | 'fy' | 'all'. The server recomputes on every call (nothing is
// cached anywhere), so the Revenue selector re-requests rather than switching between figures it
// fetched earlier — that's what keeps "recomputes on change" literally true.
export function getDashboardOverview({ revenuePeriod } = {}) {
  const query = revenuePeriod ? `?revenuePeriod=${encodeURIComponent(revenuePeriod)}` : '';
  return apiFetch(`/api/dashboard/overview${query}`);
}
