import { apiFetch } from './client';

// POST /api/factory-debits -> { id, factoryId, amount, date, note, createdAt }. Owner-only AND
// PIN-gated (04_API_SPEC.md), identical gating to createFactoryPayment — body must include
// `pin`. A 403 here can mean MISSING_PIN, INVALID_PIN (err.extra?.attemptsRemaining tells you
// how many tries are left), or PIN_LOCKED. Records a manual increase to amount owed — the
// mirror of a payment, which decreases it.
export function createFactoryDebit(data) {
  return apiFetch('/api/factory-debits', { method: 'POST', body: data });
}
