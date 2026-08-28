// Shared status → label/badge-colour mapping for every screen that shows an Order's status as a
// pill (Owner Dashboard's Orders page and Parties page's per-party orders list, so far).
// Consolidated so both surfaces are guaranteed to render a Billed order in the same colour rather
// than each carrying its own hand-copied map that could drift.
//
// Per 07_UI_DESIGN_BRIEF.md §3.4's token table: Placed/Packed share the Warning/Pack role,
// Billed/Shipped share the Accent/Ship/Billed role — the same pairing already visible in
// PackOrderDetail ("Placed" badge-warning), BillOrderDetail ("Packed" badge-warning) and
// ShipOrderDetail ("Billed" badge-accent).
//
// Display label for SHIPPED is "Dispatched" (renamed 2026-08-28) — a DISPLAY-ONLY rename. The
// underlying OrderStatus enum value stays SHIPPED everywhere (schema, every `status === 'SHIPPED'`
// check, the API field itself); only what a person reads on screen changed. This is the ONE key
// where the display word intentionally no longer matches the enum spelling — PLACED/PACKED/BILLED
// still read as their own lowercase/titlecase selves.
export const ORDER_STATUS_LABEL = { PLACED: 'Placed', PACKED: 'Packed', BILLED: 'Billed', SHIPPED: 'Dispatched' };
export const ORDER_STATUS_BADGE = {
  PLACED: 'badge-warning',
  PACKED: 'badge-warning',
  BILLED: 'badge-accent',
  SHIPPED: 'badge-accent',
};

// "Open order" — added 2026-08-20 for the Owner Dashboard Orders page's month-toggle split
// (Open orders section vs. a month-filtered section for everything else). MUST mirror
// dashboardController.js's own openOrders query exactly: `where: { isCancelled: false, status: {
// in: ['PLACED', 'PACKED'] } }` — that's the Overview KPI's "openOrdersCount" definition, and this
// predicate exists so the Orders page doesn't quietly redefine "open" a second, possibly
// drifting way. Frontend and backend are separate runtimes with no shared code today, so this
// can't literally import that where-clause — if it ever changes, this needs the matching change,
// and dashboardController.js's own comment on that query points back here for the same reason.
export const OPEN_ORDER_STATUSES = ['PLACED', 'PACKED'];
export function isOpenOrder(order) {
  return !order.isCancelled && OPEN_ORDER_STATUSES.includes(order.status);
}
