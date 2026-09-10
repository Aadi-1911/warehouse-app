import { apiFetch } from './client';

// The mirror of api/factoryDebits.js, reverse direction — a manual increase to what a Party owes
// (rule 106), for real pre-app debt with no Order behind it.

// POST /api/party-debits -> { id, partyId, amount, date, note, createdAt, updatedAt, wasEdited }.
// Owner-only AND PIN-gated (04_API_SPEC.md), identical gating to createPartyPayment — body must
// include `pin`. A 403 here can mean MISSING_PIN, INVALID_PIN
// (err.extra?.attemptsRemaining tells you how many tries are left), or PIN_LOCKED.
export function createPartyDebit(data) {
  return apiFetch('/api/party-debits', { method: 'POST', body: data });
}
