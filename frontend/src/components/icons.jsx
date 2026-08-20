// Inline SVG icons, shared across screens. Inline rather than an icon library because the set
// needed is tiny, and a dependency-free bundle keeps the supply-chain surface small — which
// matters more than usual here, since the JWT lives in localStorage (see LEARNING_LOG.md).
//
// Every icon draws with `stroke="currentColor"`, so it inherits the colour of whatever
// role-tinted container it sits in rather than hard-coding a hex value. That's what lets one
// icon component satisfy 07_UI_DESIGN_BRIEF.md §3.1's rule that background, border and icon
// must always share the same semantic role.

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  // Decorative: the visible text label next to each icon already names the action, so
  // announcing the icon too would just make screen readers repeat themselves.
  'aria-hidden': true,
};

// Receive Stock (§5.2 specifies a delivery truck).
export function TruckIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <path d="M16 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

// Live Stock View (§5.5 specifies a search/list icon).
export function ListIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

// Manage Users — not part of 07_UI_DESIGN_BRIEF.md (that brief is staff-facing only; this
// screen is owner-only admin, added per 01_PRD.md §95), so no icon is spec'd. A two-person
// mark is the conventional "accounts/people" icon.
export function UsersIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// Set your PIN — a key, for the price-edit PIN setup screen.
export function KeyIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

// Accordion expand/collapse indicator — rotated via CSS (.chevron-open) rather than swapped
// for a second icon, so the direction change animates instead of jumping.
export function ChevronIcon({ size = 18, className }) {
  return (
    <svg {...baseProps} width={size} height={size} className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Back-to-Home arrow — ScreenHeader's fixed navigation-home link, not a breadcrumb/back-history
// control (see ScreenHeader.jsx for why). A plain left arrow reads as "go back" without implying
// "undo the last thing," which a full arrow-in-circle or house icon would risk suggesting.
export function BackIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// Transfer — not in 07_UI_DESIGN_BRIEF.md (Transfer was an accepted Phase 1 limitation when
// that brief was written, per 05_BUSINESS_RULES.md rule 46, and only became real in rule 93),
// so no icon is spec'd. Two opposing arrows are the conventional "move between two places"
// mark, and they read as movement rather than the one-directional delivery TruckIcon shows.
export function TransferIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <polyline points="16 3 21 8 16 13" />
      <line x1="21" y1="8" x2="5" y2="8" />
      <polyline points="8 11 3 16 8 21" />
      <line x1="3" y1="16" x2="19" y2="16" />
    </svg>
  );
}

// The app's own mark in the screen header — a package, for a warehouse app.
export function PackageIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M16.5 9.4 7.5 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

// Factory Payables (§5.8) — not part of 07_UI_DESIGN_BRIEF.md's original spec (added later, no
// icon called out there either), so no icon is spec'd. A wallet is the conventional
// "money owed/paid" mark — the small circle on the flap reads as a clasp, distinguishing it
// from PackageIcon's box at a glance despite the similar overall silhouette.
export function WalletIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-5a2 2 0 0 0 0 4h6" />
      <circle cx="16.5" cy="14" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Article Pricing (§5.10) — not part of 07_UI_DESIGN_BRIEF.md's original spec (added later, no
// icon called out there either), same reasoning as WalletIcon above. A price tag is the
// conventional "cost/pricing" mark, distinguishing this from WalletIcon's "money owed" meaning
// at a glance despite both being finance-adjacent screens.
export function TagIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 3l.24 6.59a2 2 0 0 0 .59 1.42l9.59 9.58a2 2 0 0 0 2.82 0l4.35-4.35a2 2 0 0 0 0-2.83z" />
      <circle cx="7.5" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Party List (07_UI_DESIGN_BRIEF.md §5.1's "More" list) — not part of the brief's original icon
// set either. A single-person mark, deliberately distinct from UsersIcon's two-person mark:
// UsersIcon means "this app's own accounts" (Manage Users), PartyIcon means an external
// contact — the same distinction the schema itself already draws between User and Party.
export function PartyIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    </svg>
  );
}

// New Order (07_UI_DESIGN_BRIEF.md §5.1: "New Order (purple)... confirmed for the same tile
// treatment once Phase 2 exists" — a shopping bag, the conventional "placing an order" mark.
export function ShoppingBagIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

// Bill Orders — an invoice/document mark. Deliberately distinct from WalletIcon (Factory
// Payables, "money we owe out") and TagIcon (Article Pricing, "what a thing costs"): this one is
// a document, because billing here produces a record of what a Party owes, not a price or a
// payment. The ruled lines read as line items at any size.
export function InvoiceIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M6 2h9l4 4v16H6z" />
      <polyline points="14.5 2.5 14.5 6.5 18.5 6.5" />
      <line x1="9" y1="12" x2="16" y2="12" />
      <line x1="9" y1="16" x2="16" y2="16" />
    </svg>
  );
}

// Ship Order — a paper plane, the conventional "sent / on its way" mark. Deliberately NOT a
// truck: TruckIcon already means Receive Stock (goods arriving), and reusing a truck for the
// outbound direction would make the two screens read as the same action at a glance.
export function SendIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M21.5 2.5 2.5 10.2l7.3 2.9 2.9 7.3z" />
      <line x1="21.5" y1="2.5" x2="9.8" y2="13.1" />
    </svg>
  );
}

// History (§5.1's "More" list) — a clock with a counter-clockwise arrow, the conventional
// "past events / activity log" mark. Deliberately not a plain clock, which reads as "time" or
// "schedule" rather than "what already happened."
export function HistoryIcon({ size = 26 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M3 12a9 9 0 1 0 2.6-6.35" />
      <polyline points="3 3.5 3 8.5 8 8.5" />
      <polyline points="12 7.5 12 12 15 13.5" />
    </svg>
  );
}

// Pack Order (§5.4): a line item's three packing states — fully matched, short, not started.
// Grouped together since all three exist only to sit side by side on the same card and must
// read as one coherent "traffic light" set at a glance, not three unrelated icons.
export function CheckCircleIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12.5 10.8 15 16 9.5" />
    </svg>
  );
}

export function WarningTriangleIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <path d="M12 3.5 2 20h20L12 3.5z" />
      <line x1="12" y1="10" x2="12" y2="14.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// Dashed, not solid — the one visual cue in this set with no fill/solid-line equivalent
// elsewhere in the icon set, deliberately reading as "empty/unconfirmed" rather than "wrong"
// (that's WarningTriangleIcon's job) or "done" (CheckCircleIcon's).
export function NotStartedIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeDasharray="3 3">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

// Good Returns — an arrow curving back toward a box, reading as "goods coming back in." A
// distinct shape from TransferIcon's two straight opposing arrows on purpose: a transfer is a
// sideways move between our own locations, a return is inbound from outside.
export function ReturnIcon({ size = 20 }) {
  return (
    <svg {...baseProps} width={size} height={size}>
      <polyline points="9 4 4 9 9 14" />
      <path d="M4 9h9a6 6 0 0 1 6 6v5" />
    </svg>
  );
}

// --- Owner Dashboard nav (paths taken from the design bundle's own SVGs so the rail matches it
// exactly). Users/History/WarningTriangle are reused from above rather than re-drawn — the
// design's versions of those three are the same feather-style shapes already in this set.

// Overview — a four-pane grid, reading as "everything at once".
export function GridIcon({ size = 17 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeWidth={1.5}>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

// Orders — a clipboard. Distinct from InvoiceIcon (billing) and PackageIcon (the app mark) so the
// rail's five destinations stay tellable apart at 17px.
export function ClipboardIcon({ size = 17 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeWidth={1.5}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M8 11h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

// A closed padlock — the Owner Dashboard's manual lock button and its locked-overlay mark
// (added 2026-08-21). Deliberately the CLOSED shape in both places: the button's job is "make it
// locked," and the overlay's state IS locked, so an open-shackle variant would never be correct
// in either spot and isn't drawn.
export function LockIcon({ size = 17 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeWidth={1.5}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// A map pin — Owner Dashboard nav for the Locations page (added 2026-08-20). Distinct from every
// other rail icon (none of the existing set represents "a place"), matching size/weight to
// GridIcon/ClipboardIcon so all five/six rail icons read as one coherent set at 17px.
export function LocationPinIcon({ size = 17 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeWidth={1.5}>
      <path d="M12 21s7-6.7 7-12a7 7 0 0 0-14 0c0 5.3 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

// Two overlapping rectangles — the standard "copy" glyph. Used next to the GSTIN value on the
// Owner Dashboard's Parties page (§8); swapped for CheckCircleIcon briefly after a successful
// copy, reusing that icon's existing "confirmed" meaning rather than drawing a second checkmark.
export function CopyIcon({ size = 15 }) {
  return (
    <svg {...baseProps} width={size} height={size} strokeWidth={1.8}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
