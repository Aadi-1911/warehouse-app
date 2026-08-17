import { apiFetch } from './client';

// GET /api/history -> [{ id, type, label, timestamp, actorName, partyName, description }]
// Any authenticated role — both OWNER and STAFF get the identical feed, no role-based filtering.
//
// A read-time merge across Order / OrderAdjustment / Transfer, sorted newest-first server-side
// (see historyController.js). There is no shared event-log table behind this and deliberately so;
// the frontend just renders what it's given in order.
//
// `type` is one of ORDER_PLACED / ORDER_STATUS / ORDER_ADJUSTMENT / TRANSFER, used only to pick
// the tag's COLOUR. `label` is the tag's TEXT ("Placed" / "Packed" / "Billed" / "Shipped" /
// "Change" / "Transfer") — computed server-side rather than mapped from `type` here, because one
// type (ORDER_STATUS) covers three genuinely different moments that must not all read "Status".
// The body copy always comes from `description`, so a new event type added server-side renders
// sensibly without a frontend change.
export function listHistory() {
  return apiFetch('/api/history');
}
