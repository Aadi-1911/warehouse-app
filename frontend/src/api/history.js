import { apiFetch } from './client';

// GET /api/history -> [{ id, type, timestamp, actorName, partyName, description }]
// Any authenticated role — both OWNER and STAFF get the identical feed, no role-based filtering.
//
// A read-time merge across Order / OrderAdjustment / Transfer, sorted newest-first server-side
// (see historyController.js). There is no shared event-log table behind this and deliberately so;
// the frontend just renders what it's given in order. `type` is one of ORDER_PLACED /
// ORDER_STATUS / ORDER_ADJUSTMENT / TRANSFER, used only to pick an icon and tag — the
// human-readable text always comes from `description`, so a new event type added server-side
// renders sensibly here without a frontend change.
export function listHistory() {
  return apiFetch('/api/history');
}
