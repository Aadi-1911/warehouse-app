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
