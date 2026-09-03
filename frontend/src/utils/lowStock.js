// Rule 56: ≤1 set = a small red flag/badge, unified across every screen that shows real stock
// quantity, so the same row never reads "low" on one screen and fine on another. Consolidated
// here 2026-08-20 — Live Stock and New Order each carried their own copy of this same number.
//
// Lowered from 2 to 1 on 2026-08-26 (a deliberate rule change, not a bug fix). The backend keeps
// its OWN copy of this number in controllers/dashboardController.js for the Overview KPI's
// server-side count — frontend and backend are separate codebases with no shared-constants
// package, same reason utils/piecesPerSet.js is duplicated. The two MUST be changed together or
// the Overview KPI silently disagrees with every screen that renders a badge.
export const LOW_STOCK_THRESHOLD = 1;
