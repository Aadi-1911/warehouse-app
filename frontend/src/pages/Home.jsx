import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { TruckIcon, ListIcon, TransferIcon, PackageIcon, UsersIcon, KeyIcon } from '../components/icons';

// Home screen — 07_UI_DESIGN_BRIEF.md §5.1.
//
// The brief specifies a 2x2 grid of four tiles (Receive Stock, Live Stock, New Order, Pack
// Order), but the two Order screens are Phase 2 entities (06_ROADMAP.md) and don't exist yet —
// dead tiles for unbuilt screens aren't rendered. Transfer takes the third slot: it wasn't in
// the brief at all (transfers were an accepted Phase 1 limitation, 05_BUSINESS_RULES.md rule
// 46, and only became real in rule 93), but it's a daily-use staff action that moves live
// stock, which is exactly what this grid is for. The grid is two columns, so the Phase 2 pair
// still slots in later without a layout change.
const TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'success', Icon: TruckIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'accent', Icon: ListIcon },
  { to: '/transfer', label: 'Transfer Stock', tone: 'accent', Icon: TransferIcon },
];

export default function Home() {
  const { user, logout } = useAuth();

  // Drives the footer note below. Read from auth state, which re-derives the role from the
  // server on every load — never from anything the browser stored (see useAuth.jsx).
  const isStaff = user.role === 'STAFF';
  const isOwner = user.role === 'OWNER';

  return (
    <div className="page">
      <header className="screen-header">
        <div className="icon-mark accent">
          <PackageIcon />
        </div>
        <div>
          <div className="eyebrow">Warehouse</div>
          {/* The brief gives the Home greeting its own larger type size (21px) than the
              standard 18px screen title, so it uses a distinct class. */}
          <h1 className="greeting">Hello, {user.name}</h1>
        </div>
        <span className={`badge ${user.role === 'OWNER' ? 'badge-purple' : 'badge-accent'}`}>
          {user.role}
        </span>
      </header>

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

      {/* Owner-only, deliberately NOT in the tile grid above — 01_PRD.md §95 calls this
          "owner-only, low-frequency use," which argues against a large tile competing
          visually with the daily-use staff actions. */}
      {isOwner && (
        <Link to="/users" className="secondary-link-row">
          <UsersIcon size={18} />
          <span>Manage Users</span>
        </Link>
      )}

      <button type="button" className="btn-secondary" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
