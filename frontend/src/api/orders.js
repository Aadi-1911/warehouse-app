import { apiFetch } from './client';

// POST /api/orders -> the created order, same detail shape GET /api/orders/:id returns.
// Any authenticated role (04_API_SPEC.md) — staff placing orders during a sample visit is the
// primary real-world use case (rule 25).
export function createOrder({ partyId, lineItems }) {
  return apiFetch('/api/orders', { method: 'POST', body: { partyId, lineItems } });
}

// GET /api/orders?status=&partyId=&from=&to= -> [{ id, partyId, partyName, status, createdAt,
// lineItemCount, totalValue }]. Pack Order's list view calls this with status: 'PLACED' — the
// only status a line item can still be packed from.
export function listOrders({ status, partyId, from, to } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (partyId) params.set('partyId', partyId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return apiFetch(`/api/orders${query ? `?${query}` : ''}`);
}

// GET /api/orders/:id -> full detail, every line item with the article/color info needed to
// actually display it. Pack List's detail view calls this to load the order it's packing.
export function getOrder(id) {
  return apiFetch(`/api/orders/${id}`);
}

// PATCH /api/orders/:id/pack -> the updated order, same shape as getOrder. Body must cover
// every line on the order, not just the ones staff actually changed (04_API_SPEC.md) — the
// backend rejects a partial submission rather than defaulting missing lines to anything.
export function packOrder(id, lineItems) {
  return apiFetch(`/api/orders/${id}/pack`, { method: 'PATCH', body: { lineItems } });
}

// PATCH /api/orders/:id/bill -> the updated order, same shape as getOrder. OWNER ONLY (rule 63)
// and the single irreversible step in the lifecycle: it deducts real stock FIFO across locations
// and applies rule 23's hard lock. Body (added 2026-08-25, rule 101): { discountApplicable?,
// discountPercent?, gstApplicable?, gstPercent? } — all optional, defaulting to no discount/no
// GST. The server independently recomputes and stores preTaxAmount/finalAmount/actualPayable;
// nothing computed client-side is ever trusted as the value that gets written.
//
// `billNo` (optional, 2026-08-30) rides along in the same body: a display-only reference tag for
// the bill this order was billed under. It takes no part in any of the amount arithmetic above,
// and unlike those amounts it stays correctable afterwards via updateOrderBillNo below.
// `locationId` and `locationConfirmed: true` (2026-09-07) are BOTH REQUIRED in the body — the
// server 400s without them, deliberately with no default location. Billing draws stock from
// exactly one explicitly-chosen location; it no longer walks every location alphabetically and can
// no longer split one line across two of them. Callers must send the owner's real toggle choice
// and their real checkbox state, never a hardcoded `true`.
export function billOrder(id, billing = {}) {
  return apiFetch(`/api/orders/${id}/bill`, { method: 'PATCH', body: billing });
}

// GET /api/orders/:id/fulfillment-preview?locationId=... -> { orderId, locationId, locationName,
// canFulfill, lines: [{ lineItemId, bundleId, needed, available, sufficient, articleNo,
// productName, colorName }] }. OWNER only, same gate as billOrder itself.
//
// Read-only and takes no lock — it answers "if I billed from here right now, what would happen?"
// so a wrong-location mistake is visible in the form instead of arriving as a 409 after the
// irreversible button. It is a SNAPSHOT: stock can move between previewing and billing, and
// billOrder re-checks atomically at commit time regardless of what this said.
export function getOrderFulfillmentPreview(id, locationId) {
  return apiFetch(`/api/orders/${id}/fulfillment-preview?locationId=${encodeURIComponent(locationId)}`);
}

// PATCH /api/orders/:id/bill-no -> the updated order, same shape as getOrder. OWNER ONLY, no PIN.
// Corrects the reference tag on an already-billed order — rule 23 locks the order's money and
// contents, not a reference tag, and this endpoint provably can't touch either. 409
// ORDER_NOT_BILLED if the order hasn't been billed yet. Pass null to clear it.
//
// NOTE: `billNo` is OWNER-only on READ too — the server never selects it for a STAFF request, so
// it's simply absent from order objects on STAFF-facing screens (Pack Order, Dispatch Order).
export function updateOrderBillNo(id, billNo) {
  return apiFetch(`/api/orders/${id}/bill-no`, { method: 'PATCH', body: { billNo } });
}

// PATCH /api/orders/:id/billing-correction -> the updated order, same shape as getOrder.
// OWNER **and** PIN (rule 105, 2026-09-08) — unlike updateOrderBillNo above, which takes no PIN
// because it cannot move money. Every field this writes is money, so `pin` is always required.
//
// Revises discount/GST on an order that has ALREADY been billed. The server recomputes
// finalAmount/actualPayable from the order's own untouched preTaxAmount (rule 23 keeps line items
// frozen, so the pre-tax figure never moves) using the same function billing itself uses — nothing
// computed client-side is ever sent or trusted.
//
// Both flags can be flipped in either direction: false -> true is the main case (an order billed
// without GST that now needs it), and true -> false is equally valid. The resulting amount can go
// UP or DOWN — a retroactive discount legitimately lowers it (rule 103's own warning against
// assuming billing only ever increases a total).
//
// `reason` is required and must be one of GST_ADDED_RETROACTIVELY / GST_PERCENT_CORRECTED /
// DISCOUNT_ADDED_RETROACTIVELY / DISCOUNT_PERCENT_CORRECTED / OTHER; `note` is required only when
// reason is OTHER. 409 ORDER_NOT_BILLED on an unbilled order, 409 ORDER_HAS_NO_BILLING_SNAPSHOT on
// one billed before rule 101 shipped (no stored preTaxAmount to correct against).
export function correctOrderBilling(id, correction) {
  return apiFetch(`/api/orders/${id}/billing-correction`, { method: 'PATCH', body: correction });
}

// PATCH /api/orders/:id/ship -> the updated order, same shape as getOrder. Any authenticated
// role (rule 63). No body, no stock or line-item consequence — purely records that the order left.
export function shipOrder(id) {
  return apiFetch(`/api/orders/${id}/ship`, { method: 'PATCH' });
}

// PATCH /api/orders/:id/lines/:lineItemId/cancel -> the updated order. OWNER ONLY.
// Flags the line cancelled; never rewrites its quantities, so the original ask and count stay
// readable. Only allowed while the order is PLACED or PACKED (409 otherwise).
export function cancelOrderLine(orderId, lineItemId) {
  return apiFetch(`/api/orders/${orderId}/lines/${lineItemId}/cancel`, { method: 'PATCH' });
}

// PATCH /api/orders/:id/cancel -> the updated order. OWNER ONLY.
// Flags the whole order cancelled. Line items are deliberately left untouched — the order-level
// flag is what every worklist and guard reads.
export function cancelOrder(orderId) {
  return apiFetch(`/api/orders/${orderId}/cancel`, { method: 'PATCH' });
}
