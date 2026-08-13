import { apiFetch } from './client';

// POST /api/factory-debits -> { id, factoryId, amount, date, note, createdAt, updatedAt,
// wasEdited }. Owner-only AND PIN-gated (04_API_SPEC.md), identical gating to
// createFactoryPayment — body must include `pin`. A 403 here can mean MISSING_PIN, INVALID_PIN
// (err.extra?.attemptsRemaining tells you how many tries are left), or PIN_LOCKED. Records a
// manual increase to amount owed — the mirror of a payment, which decreases it.
export function createFactoryDebit(data) {
  return apiFetch('/api/factory-debits', { method: 'POST', body: data });
}

// PATCH /api/factory-debits/:id -> the updated debit. Mirrors updateFactoryPayment exactly —
// same unconditional Owner+PIN gate, same fields.
export function updateFactoryDebit(id, { amount, date, note, pin }) {
  return apiFetch(`/api/factory-debits/${id}`, { method: 'PATCH', body: { amount, date, note, pin } });
}

// DELETE /api/factory-debits/:id -> null (204 No Content). Mirrors deleteFactoryPayment exactly.
export function deleteFactoryDebit(id, { pin }) {
  return apiFetch(`/api/factory-debits/${id}`, { method: 'DELETE', body: { pin } });
}
