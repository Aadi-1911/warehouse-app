// Shared status → label/badge-colour mapping for every screen that shows an Order's status as a
// pill (Owner Dashboard's Orders page and Parties page's per-party orders list, so far).
// Consolidated so both surfaces are guaranteed to render a Billed order in the same colour rather
// than each carrying its own hand-copied map that could drift.
//
// Per 07_UI_DESIGN_BRIEF.md §3.4's token table: Placed/Packed share the Warning/Pack role,
// Billed/Shipped share the Accent/Ship/Billed role — the same pairing already visible in
// PackOrderDetail ("Placed" badge-warning), BillOrderDetail ("Packed" badge-warning) and
// ShipOrderDetail ("Billed" badge-accent).
export const ORDER_STATUS_LABEL = { PLACED: 'Placed', PACKED: 'Packed', BILLED: 'Billed', SHIPPED: 'Shipped' };
export const ORDER_STATUS_BADGE = {
  PLACED: 'badge-warning',
  PACKED: 'badge-warning',
  BILLED: 'badge-accent',
  SHIPPED: 'badge-accent',
};
