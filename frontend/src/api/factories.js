import { apiFetch } from './client';

// GET /api/factories -> [{ id, name, contact }]
export function listFactories() {
  return apiFetch('/api/factories');
}

// POST /api/factories -> { id, name, contact, gstNo }. Open to any authenticated role — see
// factoryController.js: "Factories grow via normal usage, no OWNER gate."
export function createFactory(data) {
  return apiFetch('/api/factories', { method: 'POST', body: data });
}

// GET /api/factories/:id/payable -> { factoryId, totalOwed, totalPaid, amountPayable,
// payments: [{ id, amount, date, note }], debits: [{ id, amount, date, note }] }. Owner-only —
// reverse-engineerable into per-piece cost, same protection reasoning as costPrice itself
// (04_API_SPEC.md). totalOwed already folds debits in (it's the transaction-derived figure PLUS
// SUM(debits) — see factoryController.js), so callers summing payments/debits again to
// "recompute" totalOwed themselves would double count; use the server's totalOwed/amountPayable
// as-is. Note: totalOwed/totalPaid/amountPayable come back as real numbers (computed
// server-side via JS reduce), but each individual payments[]/debits[].amount is a raw Prisma
// Decimal, which serializes as a STRING ("250.5") — callers must Number() it before doing
// arithmetic or formatting as currency.
export function getFactoryPayable(factoryId) {
  return apiFetch(`/api/factories/${factoryId}/payable`);
}
