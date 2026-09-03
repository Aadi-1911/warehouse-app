import { apiFetch } from './client';

// POST /api/transaction-corrections -> { id, originalId, replacementId, reason, note, createdAt }.
// Owner-only. PIN is CONDITIONAL — only required when `costPrice` is included in the body (a
// price correction), same "role unconditional, PIN conditional on price" split
// PATCH /api/products/:id already uses. Omit `costPrice` entirely (not null) when the correction
// doesn't touch price, so the backend's `'costPrice' in req.body` check reads it as untouched.
// A 403 here (when costPrice is present) can mean MISSING_PIN, INVALID_PIN
// (err.extra?.attemptsRemaining), or PIN_LOCKED — same codes as every other PIN-gated action.
export function createTransactionCorrection(data) {
  return apiFetch('/api/transaction-corrections', { method: 'POST', body: data });
}
