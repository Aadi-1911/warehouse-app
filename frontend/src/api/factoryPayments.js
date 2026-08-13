import { apiFetch } from './client';

// POST /api/factory-payments -> { id, factoryId, amount, date, note, createdAt, updatedAt,
// wasEdited }. Owner-only AND PIN-gated (04_API_SPEC.md) — body must include `pin`. A 403 here
// can mean MISSING_PIN, INVALID_PIN (err.extra?.attemptsRemaining tells you how many tries are
// left), or PIN_LOCKED. wasEdited is always false for a freshly-created entry.
export function createFactoryPayment(data) {
  return apiFetch('/api/factory-payments', { method: 'POST', body: data });
}

// PATCH /api/factory-payments/:id -> the updated payment. Owner-only AND PIN-gated,
// unconditionally — pin is always required here, unlike Product's PATCH where it's only
// required for price fields (every field on this resource is financial). Same 403 codes as
// createFactoryPayment.
export function updateFactoryPayment(id, { amount, date, note, pin }) {
  return apiFetch(`/api/factory-payments/${id}`, { method: 'PATCH', body: { amount, date, note, pin } });
}

// DELETE /api/factory-payments/:id -> null (204 No Content). Owner-only AND PIN-gated,
// unconditionally. A genuine hard delete — nothing else references a FactoryPayment by foreign
// key, so no soft-deactivate pattern is needed here the way it is for Factory/Product/etc.
export function deleteFactoryPayment(id, { pin }) {
  return apiFetch(`/api/factory-payments/${id}`, { method: 'DELETE', body: { pin } });
}
