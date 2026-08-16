import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ScreenHeader from '../components/ScreenHeader';
import {
  TruckIcon,
  ListIcon,
  TransferIcon,
  PackageIcon,
  UsersIcon,
  KeyIcon,
  WalletIcon,
  TagIcon,
  PartyIcon,
  ShoppingBagIcon,
} from '../components/icons';

// Home screen — 07_UI_DESIGN_BRIEF.md §5.1, updated per §5.1's own "— updated" entry.
//
// Colored tiles are reserved for core, frequent, semantically-distinct actions only — Receive
// Stock (green) and Live Stock (blue), and now New Order (purple), per §5.1's own already-
// written note that New Order gets this exact treatment "once Phase 2 exists" — it now does
// (Order/OrderLineItem/OrderAdjustment migrated, POST/GET /api/orders built). Pack Order
// (amber) still isn't built, so it stays unrendered for now — a dead tile for an unbuilt
// screen was already the rule before this change; it just used to apply to two screens,
// now one. Everything else that used to compete for a colored tile slot — Transfer, plus the
// owner-only admin screens — lives in the plain "More" list below instead: icon + label only,
// no color tint, same treatment §5.1 gives Transfer/Low Stock/History in the reference.
// Colored tiles stay a flat, unconditional array (nothing in it is ever role-gated — New
// Order is reachable by any authenticated role, rule 25, same as the other two); the More
// list is where per-item visibility logic lives, since that's the only place it still applies.
const TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'success', Icon: TruckIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'accent', Icon: ListIcon },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon },
];

// Each entry decides its own visibility from `user` — Transfer is unconditional (any
// authenticated role), the other five are owner-only. Set PIN/Change PIN are a deliberately
// exclusive pair — exact inverse conditions on the same hasPinSet flag, routing to the same
// SetPin.jsx screen, which now branches on hasPinSet itself to decide which mode to render (no
// currentPin field for first-time setup, currentPin required once a PIN already exists — see
// SetPin.jsx). Exactly one of the two is ever visible for a given owner, never both, never
// neither. Kept alongside the existing prompt-banner-warning below rather than replacing it:
// that banner is a higher-visibility nudge for a blocking action (no PIN means no price edits,
// now no Factory Payments either), which is a different job than a plain list row — the banner
// only ever mirrors Set PIN's condition, never Change PIN's.
const MORE_ITEMS = [
  { to: '/transfer', label: 'Transfer Stock', Icon: TransferIcon, show: () => true },
  // Owner-only, same as Manage Users/Factory Payables/Article Pricing below — GET /api/parties
  // is any authenticated role at the API level (04_API_SPEC.md), but this screen has no
  // staff-facing purpose today (not wired into New Order, which doesn't exist yet), so until
  // then it's just a contact directory. Corrected from an initial `show: () => true` that
  // shipped this to STAFF too — see LEARNING_LOG.md.
  { to: '/parties', label: 'Manage Parties', Icon: PartyIcon, show: (user) => user.role === 'OWNER' },
  { to: '/users', label: 'Manage Users', Icon: UsersIcon, show: (user) => user.role === 'OWNER' },
  {
    to: '/set-pin',
    label: 'Set PIN',
    Icon: KeyIcon,
    show: (user) => user.role === 'OWNER' && !user.hasPinSet,
  },
  {
    to: '/set-pin',
    label: 'Change PIN',
    Icon: KeyIcon,
    show: (user) => user.role === 'OWNER' && user.hasPinSet,
  },
  { to: '/factory-payables', label: 'Factory Payables', Icon: WalletIcon, show: (user) => user.role === 'OWNER' },
  { to: '/article-pricing', label: 'Article Pricing', Icon: TagIcon, show: (user) => user.role === 'OWNER' },
];

export default function Home() {
  const { user, logout } = useAuth();

  // Drives the footer note below. Read from auth state, which re-derives the role from the
  // server on every load — never from anything the browser stored (see useAuth.jsx).
  const isStaff = user.role === 'STAFF';
  const isOwner = user.role === 'OWNER';

  return (
    <div className="page">
      {/* Home is the one screen with nothing to go back to, so it opts out of ScreenHeader's
          default back-to-Home link (showBackLink={false}) — see ScreenHeader.jsx. The brief
          gives Home's greeting its own larger type size (21px) than the standard 18px screen
          title, hence titleClassName="greeting" instead of the default. The role badge is
          Home-specific extra content, passed as children rather than built into ScreenHeader
          itself, so the shared component stays generic. */}
      <ScreenHeader
        icon={<PackageIcon />}
        title={`Hello, ${user.name}`}
        titleClassName="greeting"
        showBackLink={false}
      >
        <span className={`badge ${user.role === 'OWNER' ? 'badge-purple' : 'badge-accent'}`}>
          {user.role}
        </span>
      </ScreenHeader>

      <nav className="tile-grid">
        {TILES.map(({ to, label, tone, Icon }) => (
          // Rendered as real links rather than buttons with click handlers: navigation is what
          // an anchor is for, so middle-click/long-press to open in a new tab keeps working,
          // and the browser shows the destination on hover.
          <Link key={to} to={to} className={`tile tile-${tone}`}>
            <Icon />
            <span className="tile-label">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Staff-only. The brief words this as "owner-only and hidden from this account", which
          is only true from a staff perspective — showing an owner a note saying pricing is
          hidden from them would be actively wrong, since it isn't. */}
      {isStaff && (
        <p className="footer-note">
          Pricing and article setup are managed by the owner, and are hidden from this account.
        </p>
      )}

      {/* Self-service prompt, not a forced redirect (01_PRD.md §95: setting a PIN is something
          "the new owner does themselves"). Only ever shown to the owner it's actually about —
          hasPinSet reflects THIS account's own priceEditPinHash, never anyone else's. */}
      {isOwner && !user.hasPinSet && (
        <Link to="/set-pin" className="prompt-banner prompt-banner-warning">
          <KeyIcon size={18} />
          <span>Set your price-edit PIN to enable editing costs and prices.</span>
        </Link>
      )}

      {/* §5.1's "More" list — everything that isn't a core, frequent, semantically-distinct
          action lives here instead of competing for a colored tile: Transfer (any role) plus
          the owner-only admin/finance screens. Each item's own `show(user)` decides inclusion,
          since the conditions genuinely differ per item (Set PIN's is stricter than the rest —
          see MORE_ITEMS' own comment for why). The `some(...)` guard means a "More" label never
          renders above zero rows — not reachable today (Transfer always shows), but free
          insurance against that changing later. */}
      {MORE_ITEMS.some((item) => item.show(user)) && (
        <div className="more-list">
          <div className="eyebrow more-list-label">More</div>
          {MORE_ITEMS.filter((item) => item.show(user)).map(({ to, label, Icon }) => (
            <Link key={to} to={to} className="secondary-link-row">
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      )}

      <button type="button" className="btn-secondary" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
