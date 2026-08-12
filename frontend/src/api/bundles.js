import { apiFetch } from './client';

// POST /api/bundles -> { id, productId, colorId }
// Creates the Product+Color link. For a brand-new article this IS the moment a picked color
// becomes a real, valid option for it — see ReceiveStock.jsx's New-article color staging.
export function createBundle(productId, colorId) {
  return apiFetch('/api/bundles', { method: 'POST', body: { productId, colorId } });
}
