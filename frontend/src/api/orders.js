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
