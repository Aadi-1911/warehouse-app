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
  HistoryIcon,
  InvoiceIcon,
  SendIcon,
  ReturnIcon,
} from '../components/icons';

// Home screen — 07_UI_DESIGN_BRIEF.md §5.1, updated per §5.1's own "— updated" entry.
//
// Colored tiles are reserved for core, frequent, semantically-distinct actions only. The four
// order-lifecycle stages now each have one — New Order (purple) -> Pack Order (amber) ->
// Bill Orders (accent) -> Ship Order (accent) — alongside Receive Stock (green) and Live Stock
// (accent). Everything else lives in the plain "More" list below: icon + label only, no color
// tint, same treatment §5.1 gives Transfer/Low Stock/History in the reference.
//
// Tones come from §3.4's semantic token table, not picked freely. That table's Accent row is
// literally labelled "Accent / Info / Stock / Ship / Billed", which is why Bill, Ship AND Live
// Stock all legitimately land on accent — following the project's own tokens rather than
// inventing new colours to keep them visually distinct. Their icons and labels are what tell
// them apart.
//
// `show(user)` was added here when Bill Orders arrived: this array used to be flat and
// unconditional, and its old comment asserted nothing in it was ever role-gated. That stopped
// being true — billing is OWNER-only (rule 63) — so tiles now carry the same visibility
// predicate MORE_ITEMS already used, rather than a second mechanism. Everything else stays
// `() => true`, which is exactly what it meant before.
const TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'success', Icon: TruckIcon, show: () => true },
  { to: '/live-stock', label: 'Live Stock', tone: 'accent', Icon: ListIcon, show: () => true },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon, show: () => true },
  { to: '/pack-orders', label: 'Pack Order', tone: 'warning', Icon: PackageIcon, show: () => true },
  { to: '/bill-orders', label: 'Bill Orders', tone: 'accent', Icon: InvoiceIcon, show: (user) => user.role === 'OWNER' },
  // Any role, rule 63 — staff mark orders shipped, same reasoning as Pack Order above.
  { to: '/ship-orders', label: 'Ship Order', tone: 'accent', Icon: SendIcon, show: () => true },
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
  // Unconditional, like Transfer above — both roles see the identical feed. A plain row rather
  // than a coloured tile: History is a look-something-up utility, not one of the core frequent
  // actions §5.1 reserves tiles for.
  { to: '/history', label: 'History', Icon: HistoryIcon, show: () => true },
  // Unconditional — both roles log returns (POST /api/returns is any-role). A plain row rather
  // than a coloured tile, deliberately: tiles are reserved for the core frequent actions, and a
  // Party sending goods back is a real but occasional event, not part of the daily loop.
  { to: '/good-returns', label: 'Good Returns', Icon: ReturnIcon, show: () => true },
  // Any-role as of 2026-08-18. This was owner-only on the grounds that the screen had no
  // staff-facing purpose "until New Order exists" — it does now, and picks a Party on every
  // order, so staff genuinely need to browse and add customers. (Note this reverses an earlier
  // correction that went the other way, for a reason that has since expired rather than because
  // that correction was wrong at the time — see LEARNING_LOG.md.) Archive/reactivate remains
  // owner-only inside the screen and at the API.
  { to: '/parties', label: 'Manage Parties', Icon: PartyIcon, show: () => true },
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
        {TILES.filter((tile) => tile.show(user)).map(({ to, label, tone, Icon }) => (
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
