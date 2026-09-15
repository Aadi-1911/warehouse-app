import { apiFetch } from './client';

// GET /api/transfers -> [{ id, bundleId, productId, productArticleNo, productName, colorId,
// colorName, fromLocationId, fromLocationName, toLocationId, toLocationName, qtySets, note,
// createdAt, userId, userName }] — newest first.
export function listTransfers(params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  return apiFetch(`/api/transfers${query ? `?${query}` : ''}`);
}

// POST /api/transfers -> { transfer, fromStock, toStock, idempotentReplay }. Open to any
// authenticated role. The ONLY way a TRANSFER_OUT/TRANSFER_IN pair is ever created — POST
// /api/transactions rejects both types outright, since a lone leg would move stock out of one
// location without it arriving anywhere.
//
// idempotencyKey (rule 107) is generated once per staged line by the caller and reused on every
// retry of that line. Sending the same key twice does NOT move stock twice: the second call
// returns 200 with idempotentReplay: true and the originally-created transfer, instead of 201.
// Both are successes as far as this function is concerned — apiFetch only rejects on a non-OK
// status, so a replay resolves normally and the caller needs no special handling.
export function createTransfer({ bundleId, fromLocationId, toLocationId, qtySets, note, idempotencyKey }) {
  return apiFetch('/api/transfers', {
    method: 'POST',
    body: { bundleId, fromLocationId, toLocationId, qtySets, note, idempotencyKey },
  });
}
