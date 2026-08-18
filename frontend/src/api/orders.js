import { apiFetch } from './client';

// POST /api/orders -> the created order, same detail shape GET /api/orders/:id returns.
// Any authenticated role (04_API_SPEC.md) — staff placing orders during a sample visit is the
// primary real-world use case (rule 25).
export function createOrder({ partyId, lineItems }) {
  return apiFetch('/api/orders', { method: 'POST', body: { partyId, lineItems } });
}

// GET /api/orders?status=&partyId=&from=&to= -> [{ id, partyId, partyName, status, createdAt,
// lineItemCount, totalValue }]. Pack Order's list view calls this with status: 'PLACED' — the
// only status a line item can still be packed from.
export function listOrders({ status, partyId, from, to } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (partyId) params.set('partyId', partyId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiFetch(`/api/orders${query ? `?${query}` : ''}`);
}

// GET /api/orders/:id -> full detail, every line item with the article/color info needed to
// actually display it. Pack List's detail view calls this to load the order it's packing.
export function getOrder(id) {
  return apiFetch(`/api/orders/${id}`);
}

// PATCH /api/orders/:id/pack -> the updated order, same shape as getOrder. Body must cover
// every line on the order, not just the ones staff actually changed (04_API_SPEC.md) — the
// backend rejects a partial submission rather than defaulting missing lines to anything.
export function packOrder(id, lineItems) {
  return apiFetch(`/api/orders/${id}/pack`, { method: 'PATCH', body: { lineItems } });
}

// PATCH /api/orders/:id/bill -> the updated order, same shape as getOrder. OWNER ONLY (rule 63)
// and the single irreversible step in the lifecycle: it deducts real stock FIFO across locations
// and applies rule 23's hard lock. No body — there's no formal Bill document entity yet.
export function billOrder(id) {
  return apiFetch(`/api/orders/${id}/bill`, { method: 'PATCH' });
}

// PATCH /api/orders/:id/ship -> the updated order, same shape as getOrder. Any authenticated
// role (rule 63). No body, no stock or line-item consequence — purely records that the order left.
export function shipOrder(id) {
  return apiFetch(`/api/orders/${id}/ship`, { method: 'PATCH' });
}

// PATCH /api/orders/:id/lines/:lineItemId/cancel -> the updated order. OWNER ONLY.
// Flags the line cancelled; never rewrites its quantities, so the original ask and count stay
// readable. Only allowed while the order is PLACED or PACKED (409 otherwise).
export function cancelOrderLine(orderId, lineItemId) {
  return apiFetch(`/api/orders/${orderId}/lines/${lineItemId}/cancel`, { method: 'PATCH' });
}

// PATCH /api/orders/:id/cancel -> the updated order. OWNER ONLY.
// Flags the whole order cancelled. Line items are deliberately left untouched — the order-level
// flag is what every worklist and guard reads.
export function cancelOrder(orderId) {
  return apiFetch(`/api/orders/${orderId}/cancel`, { method: 'PATCH' });
}
