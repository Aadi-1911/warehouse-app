import { apiFetch } from './client';

// POST /api/factory-payments -> { id, factoryId, amount, date, note, createdAt }. Owner-only
// AND PIN-gated (04_API_SPEC.md) — body must include `pin`. A 403 here can mean MISSING_PIN,
// INVALID_PIN (err.extra?.attemptsRemaining tells you how many tries are left), or PIN_LOCKED.
export function createFactoryPayment(data) {
  return apiFetch('/api/factory-payments', { method: 'POST', body: data });
}
