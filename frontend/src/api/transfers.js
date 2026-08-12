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

// POST /api/transfers -> { transfer, fromStock, toStock }. Open to any authenticated role.
// The ONLY way a TRANSFER_OUT/TRANSFER_IN pair is ever created — POST /api/transactions
// rejects both types outright, since a lone leg would move stock out of one location without
// it arriving anywhere.
export function createTransfer({ bundleId, fromLocationId, toLocationId, qtySets, note }) {
  return apiFetch('/api/transfers', {
    method: 'POST',
    body: { bundleId, fromLocationId, toLocationId, qtySets, note },
  });
}
