import { apiFetch } from './client';

// The mirror of api/factoryPayments.js, reverse direction — money a Party pays TO the business.

// POST /api/party-payments -> { id, partyId, amount, date, note, createdAt, updatedAt,
// wasEdited }. Owner-only AND PIN-gated (04_API_SPEC.md) — body must include `pin`. A 403 here
// can mean MISSING_PIN, INVALID_PIN (err.extra?.attemptsRemaining tells you how many tries are
// left), PIN_LOCKED, or PIN_NOT_SET. wasEdited is always false for a freshly-created entry.
export function createPartyPayment(data) {
  return apiFetch('/api/party-payments', { method: 'POST', body: data });
}

// PATCH /api/party-payments/:id -> the updated payment. Owner-only AND PIN-gated,
// unconditionally — pin is always required here, same reasoning as Factory Payments (every
// field on this resource is financial). Same 403 codes as createPartyPayment.
export function updatePartyPayment(id, { amount, date, note, pin }) {
  return apiFetch(`/api/party-payments/${id}`, { method: 'PATCH', body: { amount, date, note, pin } });
}

// DELETE /api/party-payments/:id -> null (204 No Content). Owner-only AND PIN-gated,
// unconditionally. A genuine hard delete — nothing else references a PartyPayment by foreign
// key, same safety argument as FactoryPayment's own delete endpoint.
export function deletePartyPayment(id, { pin }) {
  return apiFetch(`/api/party-payments/${id}`, { method: 'DELETE', body: { pin } });
}
