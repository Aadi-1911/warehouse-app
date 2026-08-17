import { apiFetch } from './client';

// POST /api/orders -> the created order, same detail shape GET /api/orders/:id returns.
// Any authenticated role (04_API_SPEC.md) — staff placing orders during a sample visit is the
// primary real-world use case (rule 25).
export function createOrder({ partyId, lineItems }) {
  return apiFetch('/api/orders', { method: 'POST', body: { partyId, lineItems } });
}
