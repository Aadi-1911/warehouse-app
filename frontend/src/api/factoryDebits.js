import { apiFetch } from './client';

// POST /api/factory-debits -> { id, factoryId, amount, date, note, billNo, createdAt, updatedAt,
// wasEdited }. Owner-only AND PIN-gated (04_API_SPEC.md), identical gating to
// createFactoryPayment — body must include `pin`. A 403 here can mean MISSING_PIN, INVALID_PIN
// (err.extra?.attemptsRemaining tells you how many tries are left), or PIN_LOCKED. Records a
// manual increase to amount owed — the mirror of a payment, which decreases it.
//
// `billNo` (optional, 2026-08-30) is a display-only reference tag — the supplier's bill number
// for this debit. Never summed or used in any amount calculation. Debits only: FactoryPayment
// has no such field, deliberately (one payment routinely settles several bills at once).
export function createFactoryDebit(data) {
  return apiFetch('/api/factory-debits', { method: 'POST', body: data });
}

// PATCH /api/factory-debits/:id -> the updated debit. Mirrors updateFactoryPayment exactly —
// same unconditional Owner+PIN gate, same fields.
export function updateFactoryDebit(id, { amount, date, note, pin }) {
  return apiFetch(`/api/factory-debits/${id}`, { method: 'PATCH', body: { amount, date, note, pin } });
}

// PATCH /api/factory-debits/:id/bill-no -> the updated debit. OWNER only, NO PIN — this endpoint
// can only change the reference tag, never an amount, so the PIN that guards the PATCH above
// would be decorative here. Never sets wasEdited: that flag means "the money was corrected," and
// a mistyped bill number isn't that. Pass billNo: null to clear it.
export function updateFactoryDebitBillNo(id, billNo) {
  return apiFetch(`/api/factory-debits/${id}/bill-no`, { method: 'PATCH', body: { billNo } });
}

// DELETE /api/factory-debits/:id -> null (204 No Content). Mirrors deleteFactoryPayment exactly.
export function deleteFactoryDebit(id, { pin }) {
  return apiFetch(`/api/factory-debits/${id}`, { method: 'DELETE', body: { pin } });
}
