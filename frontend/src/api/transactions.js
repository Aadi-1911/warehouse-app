import { apiFetch } from './client';

// POST /api/transactions -> { transaction, updatedStock }
// The only way Stock quantities ever change (02_ARCHITECTURE.md §5) — Save Receipt calls this
// once per color-line, sequentially, never batched (see ReceiveStock.jsx).
export function createTransaction({ bundleId, locationId, type, qtySets, note }) {
  const body = { bundleId, locationId, type, qtySets };
  if (note) body.note = note;
  return apiFetch('/api/transactions', { method: 'POST', body });
}
