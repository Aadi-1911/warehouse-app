import { apiFetch } from './client';

// POST /api/transfer-corrections -> { id, originalTransferId, replacementTransferId, reason, note, createdAt }.
// Owner-only, no PIN ever — a Transfer never touches price, unlike transactionCorrections.js's
// createTransactionCorrection (which conditionally requires one).
export function createTransferCorrection(data) {
  return apiFetch('/api/transfer-corrections', { method: 'POST', body: data });
}
