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
  GridIcon,
  WarningTriangleIcon,
} from '../components/icons';

// Home screen — 07_UI_DESIGN_BRIEF.md §5.1, updated per §5.1's own "— updated" entry.
//
// As of 2026-08-22 the OWNER and STAFF tile grids are genuinely different arrays, not one
// array filtered by role. That split became necessary (not just tidier) once Ship Order's
// *colour* started differing by role too — this was true even in that day's first version
// (STAFF on Accent, OWNER on Teal); a same-day follow-up then moved STAFF onto Teal as well,
// so the two arrays now agree on Ship Order's tone but still diverge on which tiles exist at
// all (Transfer Stock is a STAFF-only tile; Article Pricing/History are OWNER-only tiles). A
// single `show(user)`-filtered array can vary *visibility* per role but not a tile's own tone
// for the same route on the day the two roles briefly disagreed, so it stopped fitting then and
// staying split is simpler than reconverging now.
//
// Colored tiles are reserved for core, frequent, semantically-distinct actions — everything
// else lives in the plain "More" list, icon + label only, no colour tint.

// STAFF's tile grid — 2026-08-22, two same-day changes: Ship Order moved from Accent to Teal
// (deliberately matching OWNER's tile now, a confirmed reversal of the original "STAFF stays
// byte-for-byte unchanged" rule, scoped to just this one tile's colour), and Transfer Stock was
// promoted from MORE_ITEMS — staff use it often enough to earn a tile, and OWNER's grid was
// already fixed at exactly 8 tiles with no room/need for it there.
//
// Transfer's tone (`indigo`) is a ninth, genuinely new token — not a reuse. By this point every
// existing tone (Success, Danger, Warning, Accent, Purple, Teal, Rust, Lavender) is already in
// use somewhere across the two role screens. Danger was ruled out for the same reason it was
// ruled out for Ship Order earlier — a routine action shouldn't borrow the tone the rest of the
// app uses for "something's wrong" (low stock, damaged, remove). Rust and Lavender were ruled
// out because those exact colours mean "Article Pricing" and "History" on OWNER's own Home
// screen (see OWNER_TILES below) — reusing either for "Transfer" on STAFF's screen would make
// the same colour mean two different things to the one person (the owner) who sees both
// screens. A genuinely new tone avoids all three collisions, same precedent as Teal/Rust/
// Lavender each being added when an actual need arose rather than forced into an existing slot.
// Appended at the end of the array (no explicit order was specified) — same "append, don't
// renumber" precedent Locations/Article Pricing already established elsewhere in this app.
const STAFF_TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'success', Icon: TruckIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'accent', Icon: ListIcon },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon },
  { to: '/pack-orders', label: 'Pack Order', tone: 'warning', Icon: PackageIcon },
  // Any role, rule 63 — staff mark orders shipped, same reasoning as Pack Order above.
  { to: '/ship-orders', label: 'Ship Order', tone: 'teal', Icon: SendIcon },
  { to: '/transfer', label: 'Transfer Stock', tone: 'indigo', Icon: TransferIcon },
];

// OWNER's tile grid — reorganised 2026-08-22: Article Pricing and History promoted here from
// MORE_ITEMS (frequent enough for an owner to earn a tile), in this exact order, plus a colour
// fix for the clash Live Stock/Bill Orders/Ship Order used to share on Accent blue (§3.4's own
// token table groups "Stock / Ship / Billed" under one Accent row, which is *why* they clashed
// — this reorganisation is a deliberate departure from that table, not a bug).
//
// Live Stock keeps Accent. Bill Orders moves to Danger — reusing it (it was otherwise unused
// as a tile) rather than inventing a colour, on the reasoning that billing/money-owed is the
// closer semantic fit of the two for a red the app otherwise means "remove/low-stock/damaged"
// by. Ship Order gets a Teal token (--teal-*, added to index.css and 07_UI_DESIGN_BRIEF §3.4) —
// the palette only had one tone free (Danger) for two tiles that needed distinct new colours,
// so one had to be genuinely new; as of a same-day follow-up, STAFF's Ship Order tile uses this
// same Teal too (see STAFF_TILES above), a deliberate, confirmed reversal for this one tile.
//
// Article Pricing (Rust) and History (Lavender) launched the same day with a placeholder
// `tile-neutral` treatment (existing card tokens, no semantic colour) since the task that added
// them didn't specify a colour and every semantic tone was already claimed. A same-day
// follow-up replaced that placeholder with two real, genuinely new tones once specific colours
// were requested — `tile-neutral` itself was removed from index.css as dead code once nothing
// referenced it any more.
const OWNER_TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'success', Icon: TruckIcon },
  { to: '/article-pricing', label: 'Article Pricing', tone: 'rust', Icon: TagIcon },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon },
  { to: '/pack-orders', label: 'Pack Order', tone: 'warning', Icon: PackageIcon },
  { to: '/bill-orders', label: 'Bill Orders', tone: 'danger', Icon: InvoiceIcon },
  { to: '/ship-orders', label: 'Ship Order', tone: 'teal', Icon: SendIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'accent', Icon: ListIcon },
  { to: '/history', label: 'History', tone: 'lavender', Icon: HistoryIcon },
];

// Each entry decides its own visibility from `user`. Low Stock, Good Returns and Manage Parties
// are unconditional (any authenticated role); Transfer is OWNER-only here as of 2026-08-22 (see
// its own comment below — it's a STAFF-only tile instead now); the rest are owner-only. Set
// PIN/Change PIN are a deliberately exclusive pair — exact inverse conditions on the same
// hasPinSet flag, routing to the same
// SetPin.jsx screen, which now branches on hasPinSet itself to decide which mode to render (no
// currentPin field for first-time setup, currentPin required once a PIN already exists — see
// SetPin.jsx). Exactly one of the two is ever visible for a given owner, never both, never
// neither. Kept alongside the existing prompt-banner-warning below rather than replacing it:
// that banner is a higher-visibility nudge for a blocking action (no PIN means no price edits,
// now no Factory Payments either), which is a different job than a plain list row — the banner
// only ever mirrors Set PIN's condition, never Change PIN's.
const MORE_ITEMS = [
  // OWNER only, as of 2026-08-22 (same-day follow-up) — Transfer was unconditional until it was
  // promoted to a tile for STAFF specifically (see STAFF_TILES above), so it would otherwise
  // render in both places for a staff account. Same asymmetric-handling shape History used
  // above when IT was promoted for OWNER, just the roles reversed: OWNER's view of this row is
  // untouched (same label, same position, same icon), since `role === 'OWNER'` was already true
  // for every case that mattered to OWNER before this change.
  { to: '/transfer', label: 'Transfer Stock', Icon: TransferIcon, show: (user) => user.role === 'OWNER' },
  // Unconditional — GET /api/stock (which this screen reuses as-is, see LowStockList.jsx's own
  // header comment) is any-role already. A plain row rather than a coloured tile, same reasoning
  // as History right below: a look-something-up utility, not one of the core frequent actions
  // §5.1 reserves tiles for, even though it's closely related to Live Stock (which does get one).
  { to: '/low-stock', label: 'Low Stock', Icon: WarningTriangleIcon, show: () => true },
  // STAFF only, as of 2026-08-22 — History was unconditional until OWNER's tile reorganisation
  // promoted it to a tile for OWNER (see OWNER_TILES above), so it would otherwise render in
  // both places for an owner. STAFF's own view of this row is untouched: same label, same
  // position, same icon, still visible, since `role !== 'OWNER'` is exactly `true` for STAFF.
  { to: '/history', label: 'History', Icon: HistoryIcon, show: (user) => user.role !== 'OWNER' },
  // Unconditional — both roles log returns (POST /api/returns is any-role). A plain row rather
  // than a coloured tile, deliberately: tiles are reserved for the core frequent actions, and a
  // Party sending goods back is a real but occasional event, not part of the daily loop.
  // Label reads "GR - Goods Return" as of 2026-08-22 (was "Good Returns") — task-directed rename.
  { to: '/good-returns', label: 'GR - Goods Return', Icon: ReturnIcon, show: () => true },
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
  // Owner-only, and the one entry point to the desktop dashboard (§8). Listed here rather than
  // given a tile because it isn't a daily action — and because a tile would invite tapping it on
  // the phone, which is the one device §8 explicitly does not design this surface for.
  { to: '/dashboard', label: 'Owner Dashboard', Icon: GridIcon, show: (user) => user.role === 'OWNER' },
  { to: '/factory-payables', label: 'Factory Payables', Icon: WalletIcon, show: (user) => user.role === 'OWNER' },
  // Article Pricing lived here until 2026-08-22, when it was promoted to a tile for OWNER (see
  // OWNER_TILES above). It was already owner-only, so removing the row here doesn't change what
  // STAFF ever saw (STAFF's filtered view never included it).
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
        {(isOwner ? OWNER_TILES : STAFF_TILES).map(({ to, label, tone, Icon }) => (
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
          action lives here instead of competing for a colored tile: Low Stock/Good Returns/
          Manage Parties (any role) plus the owner-only admin/finance screens (Transfer included,
          as of 2026-08-22 — it's a tile for STAFF instead). Each item's own `show(user)` decides
          inclusion, since the conditions genuinely differ per item (Set PIN's is stricter than
          the rest — see MORE_ITEMS' own comment for why). The `some(...)` guard means a "More"
          label never renders above zero rows — not reachable today (Low Stock always shows),
          but free insurance against that changing later. */}
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
