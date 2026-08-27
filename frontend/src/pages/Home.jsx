import { useState } from 'react';
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
  ChevronIcon,
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
// Ship Order moved again on 2026-08-27, from Teal to a new Olive/mustard-green token
// (--olive-*), on both role arrays — the unification itself (both roles share one tone for this
// tile) stays exactly as confirmed above, only which tone changed. Teal is untouched and remains
// in active use elsewhere (History's per-employee name-badge feature assigns it to Ram — a
// different UI surface entirely, unrelated to Home tiles).
//
// Later the SAME day (2026-08-27), all 8 OWNER tiles got a full palette replacement — Receive
// Stock/Article Pricing/New Order/Pack Order/Bill Orders/Ship Order/Live Stock/History each now
// use their OWN dedicated `--tile-*` token (green/orange/purple/yellow/red/brown/blue/grey — see
// index.css's own `:root` comment for the reasoning), rather than reusing this app's shared
// Success/Danger/Warning/Accent/Purple tokens the way several of them did before. Those five
// shared tokens are completely untouched by this: they keep meaning exactly what they always
// have everywhere else (badges, buttons, status indicators), and none of them drive a tile's
// colour any more. This also retired Rust, Lavender AND the Olive token added just above the
// same day — all three replaced by dedicated tokens in this same pass, and removed as dead code
// once confirmed nothing else referenced them. Shared tiles (Receive Stock, New Order, Pack
// Order, Live Stock) got the identical new tone on both STAFF_TILES and OWNER_TILES below, same
// unification rule Ship Order's own colour changes have already established twice.
//
// SUPERSEDED the same day, again, by a second confirmed palette (still 2026-08-27) — the first
// palette above never shipped (staged in index.css for a few hours, never in production), so this
// is a straight replacement, not a migration preserving a live prior version. Three tiles changed
// HUE FAMILY this time, not just shade — Article Pricing moved off orange onto gold/yellow, Pack
// Order moved off yellow onto cyan/turquoise, Ship Order moved off brown/warm-stone onto true
// orange — so their `tone` identifiers below changed to match (`orange`->`gold`, `yellow`->`cyan`,
// `brown`->`orange`; the `orange` name is free to reattach to Ship Order specifically because
// Article Pricing just vacated it in the same change). Receive Stock/New Order/Bill Orders/Live
// Stock/History did NOT change hue family, so their `tone` identifiers (`green`/`purple`/`red`/
// `blue`/`grey`) are unchanged — only the underlying token hex values moved. See index.css's own
// `:root` comment for the full derivation method and the hue/saturation/lightness verification
// this second palette was checked against before accepting it.
//
// FINALIZED the same day, a third pass (still 2026-08-27) — Aadi reviewed a real before/after
// screenshot comparison of the second palette and confirmed per-tile: Live Stock and Ship Order
// stay exactly as they were; Receive Stock/New Order/Bill Orders/History keep their `tone`
// identifiers (`green`/`purple`/`red`/`grey`) with only their underlying fill/border tokens
// lightened further toward white (text ink unchanged); and Pack Order abandons cyan entirely for
// a new vivid pink (`tone: 'pink'`, base #FF9FF3) — a genuine hue-family change, not a shade
// adjustment, so `--tile-cyan-*`/`.tile-cyan` were renamed to `--tile-pink-*`/`.tile-pink` (grepped
// the whole frontend for the raw token first, same discipline as every rename today). See
// index.css's own `:root` comment for the full derivation (including how Pack Order's own fill/
// border were computed from the other 7 tiles' actual pattern, not guessed) and the honest
// hue/contrast findings this pass surfaced — most notably that Pack Order's pink sits only
// 8.3-8.8° from History's Rose actor badge by hue (flagged, not silently changed to a different
// hue), and that Article Pricing's contrast, while improved by the lightening, still falls short
// of both this app's own baseline and the WCAG AA minimum.
//
// Colored tiles are reserved for core, frequent, semantically-distinct actions — everything
// else lives in the plain "More" list, icon + label only, no colour tint.

// STAFF's tile grid — 2026-08-22, two same-day changes: Ship Order moved from Accent to Teal
// (deliberately matching OWNER's tile now, a confirmed reversal of the original "STAFF stays
// byte-for-byte unchanged" rule, scoped to just this one tile's colour — since 2026-08-27, that
// shared tone is Olive instead, see the file header comment above), and Transfer Stock was
// promoted from MORE_ITEMS — staff use it often enough to earn a tile, and OWNER's grid was
// already fixed at exactly 8 tiles with no room/need for it there.
//
// Transfer's tone (`indigo`) is a ninth, genuinely new token — not a reuse, and explicitly
// confirmed to stay exactly as-is during the 2026-08-27 tile-palette replacement (it isn't one of
// OWNER's 8 tiles, and wasn't part of that request). At the time it was added, every existing
// tone (Success, Danger, Warning, Accent, Purple, Teal, Rust, Lavender) was already in use
// somewhere across the two role screens — Rust and Lavender specifically were ruled out because
// reusing either would have meant the same colour standing for "Article Pricing"/"History" on
// OWNER's screen AND "Transfer" on STAFF's, confusing for the one person (the owner) who sees
// both. That reasoning is now historical (Rust and Lavender were retired outright the same day
// their tiles moved to Orange/Grey — see the file header comment and index.css), but Indigo
// itself was never affected by that retirement, since Transfer never used either of those tones.
// Appended at the end of the array (no explicit order was specified) — same "append, don't
// renumber" precedent Locations/Article Pricing already established elsewhere in this app.
const STAFF_TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'green', Icon: TruckIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'blue', Icon: ListIcon },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon },
  { to: '/pack-orders', label: 'Pack Order', tone: 'pink', Icon: PackageIcon },
  // Any role, rule 63 — staff mark orders shipped, same reasoning as Pack Order above.
  { to: '/ship-orders', label: 'Ship Order', tone: 'orange', Icon: SendIcon },
  { to: '/transfer', label: 'Transfer Stock', tone: 'indigo', Icon: TransferIcon },
];

// OWNER's tile grid — reorganised 2026-08-22: Article Pricing and History promoted here from
// MORE_ITEMS (frequent enough for an owner to earn a tile), in this exact order. The colours
// below reflect the 2026-08-27 full-palette replacement (see the file header comment) — every
// tile now has its OWN dedicated `--tile-*` token, so the historical reasoning about which SHARED
// token a tile borrowed (Accent, Danger, Teal, Rust, Lavender, Olive) no longer describes today's
// code; it's kept below purely as a record of how this grid got here, not as a description of the
// current CSS. At the time: Live Stock kept Accent, Bill Orders moved to Danger (reusing it
// rather than inventing a colour, since billing/money-owed was the closer semantic fit for a red
// the app otherwise means "remove/low-stock/damaged" by), Ship Order got a new Teal token (later
// Olive, per the file header comment), and Article Pricing/History launched on Rust/Lavender
// after a same-day `tile-neutral` placeholder. All of that borrowing/placeholder history ended
// 2026-08-27: every one of these 8 tiles was given its own confirmed, dedicated token instead,
// and Rust/Lavender/Olive were retired outright once nothing referenced them any more (`Danger`,
// `Accent`, `Success`, `Warning`, `Purple` themselves were never touched — only which tiles
// pointed at them, which is now none).
const OWNER_TILES = [
  { to: '/receive', label: 'Receive Stock', tone: 'green', Icon: TruckIcon },
  { to: '/article-pricing', label: 'Article Pricing', tone: 'gold', Icon: TagIcon },
  { to: '/new-order', label: 'New Order', tone: 'purple', Icon: ShoppingBagIcon },
  { to: '/pack-orders', label: 'Pack Order', tone: 'pink', Icon: PackageIcon },
  { to: '/bill-orders', label: 'Bill Orders', tone: 'red', Icon: InvoiceIcon },
  { to: '/ship-orders', label: 'Ship Order', tone: 'orange', Icon: SendIcon },
  { to: '/live-stock', label: 'Live Stock', tone: 'blue', Icon: ListIcon },
  { to: '/history', label: 'History', tone: 'grey', Icon: HistoryIcon },
];

// Each entry decides its own visibility from `user`. Low Stock and Good Returns are
// unconditional (any authenticated role); Transfer is OWNER-only here as of 2026-08-22 (see its
// own comment below — it's a STAFF-only tile instead now); Manage Parties is STAFF-only here as
// of 2026-08-25 (see its own comment below — it moved into the "Others" group for OWNER, see
// OTHERS_ITEMS further down). Manage Users, Set PIN, Change PIN, and Factory Payables lived here
// until that same 2026-08-25 change — all four were already OWNER-only, and OWNER is the only
// role that could ever see them, so their rows were removed outright rather than gated false;
// STAFF's view of this array was never affected by any of it (STAFF's filtered result never
// included any of the four in the first place).
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
  // STAFF only, as of 2026-08-25 — Manage Parties was unconditional (any-role) until it moved
  // into OWNER's new collapsible "Others" group (OTHERS_ITEMS below), so it would otherwise
  // render in both places for an owner. STAFF's own view of this row is untouched: same label,
  // same position, same icon, still an immediately-visible flat row, exactly as it was before —
  // same asymmetric-handling shape History and Transfer already used above for the same reason.
  { to: '/parties', label: 'Manage Parties', Icon: PartyIcon, show: (user) => user.role !== 'OWNER' },
  // Owner-only, and the one entry point to the desktop dashboard (§8). Listed here rather than
  // given a tile because it isn't a daily action — and because a tile would invite tapping it on
  // the phone, which is the one device §8 explicitly does not design this surface for. Left as a
  // flat row (not moved into "Others") — the task that introduced that group named four specific
  // items, and this wasn't one of them.
  { to: '/dashboard', label: 'Owner Dashboard', Icon: GridIcon, show: (user) => user.role === 'OWNER' },
];

// The four admin/settings-ish items grouped under OWNER's collapsible "Others" as of
// 2026-08-25 — pulled out of the flat MORE_ITEMS above into their own collapsed-by-default
// section, using this app's existing nested-accordion convention (Live Stock's Factory→Article
// groups; see the render below) rather than a new collapse mechanism. Same array+show(user)
// idiom as MORE_ITEMS itself, even though every entry here is unconditionally OWNER-only by
// construction (this array is only ever rendered under `isOwner` in the first place) — kept for
// consistency, and because Set PIN/Change PIN still need their own real condition. STAFF never
// sees this array at all; nothing here is STAFF-reachable by any other route either.
const OTHERS_ITEMS = [
  // Unconditional as of 2026-08-18 (see MORE_ITEMS' STAFF-only twin above for the full history);
  // this is OWNER's copy of that same row, just relocated.
  { to: '/parties', label: 'Manage Parties', Icon: PartyIcon, show: () => true },
  { to: '/users', label: 'Manage Users', Icon: UsersIcon, show: () => true },
  // Set PIN/Change PIN are a deliberately exclusive pair — exact inverse conditions on the same
  // hasPinSet flag, routing to the same SetPin.jsx screen, which itself branches on hasPinSet to
  // decide which mode to render (no currentPin field for first-time setup, currentPin required
  // once a PIN already exists — see SetPin.jsx). Exactly one of the two is ever visible, never
  // both, never neither. Kept alongside the existing prompt-banner-warning below rather than
  // replacing it: that banner is a higher-visibility nudge for a blocking action (no PIN means
  // no price edits, no Factory Payments either), a different job than a row tucked inside a
  // collapsed group — the banner only ever mirrors Set PIN's condition, never Change PIN's.
  { to: '/set-pin', label: 'Set PIN', Icon: KeyIcon, show: (user) => !user.hasPinSet },
  { to: '/set-pin', label: 'Change PIN', Icon: KeyIcon, show: (user) => user.hasPinSet },
  { to: '/factory-payables', label: 'Factory Payables', Icon: WalletIcon, show: () => true },
];

export default function Home() {
  const { user, logout } = useAuth();

  // Drives the footer note below. Read from auth state, which re-derives the role from the
  // server on every load — never from anything the browser stored (see useAuth.jsx).
  const isStaff = user.role === 'STAFF';
  const isOwner = user.role === 'OWNER';

  // "Others" group open/closed — collapsed by default (2026-08-25). A plain boolean, not the
  // Set-of-ids shape Live Stock's two-level accordion needs: there's exactly one collapsible
  // group on this screen, not an arbitrary number of independently-toggled sections.
  const [othersOpen, setOthersOpen] = useState(false);

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
          action lives here instead of competing for a colored tile: Low Stock/Good Returns (any
          role), Manage Parties (STAFF-only here as of 2026-08-25 — a flat OWNER row too until
          then, see its own comment above), Transfer and Owner Dashboard (OWNER-only). Each
          item's own `show(user)` decides inclusion, since the conditions genuinely differ per
          item. The `some(...)` guard means a "More" label never renders above zero rows — not
          reachable today (Low Stock always shows), but free insurance against that changing
          later; extended to also check OTHERS_ITEMS so the guard stays correct even on a
          hypothetical future where MORE_ITEMS itself is empty for OWNER but Others isn't. */}
      {(MORE_ITEMS.some((item) => item.show(user)) ||
        (isOwner && OTHERS_ITEMS.some((item) => item.show(user)))) && (
        <div className="more-list">
          <div className="eyebrow more-list-label">More</div>
          {MORE_ITEMS.filter((item) => item.show(user)).map(({ to, label, Icon }) => (
            <Link key={to} to={to} className="secondary-link-row">
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}

          {/* "Others" — OWNER only, collapsed by default (2026-08-25). Groups Manage Users,
              Change PIN (or Set PIN), Manage Parties, and Factory Payables out of the flat list
              above. Reuses this app's existing NESTED-accordion classes (Live Stock's
              Factory→Article groups, accordion-section.nested/accordion-header.nested/
              accordion-body.nested) rather than the outer/top-level accordion variant — the
              nested variant is styled for exactly this context (a plain top-divider between
              already-flat rows, no card shell of its own), even though this isn't literally
              nested inside another accordion the way Live Stock's Article level is; it's sitting
              inside the equally-flat, divider-separated .more-list, which is the same visual
              situation. Positioned last in OWNER's list — deliberate: reads as a
              settings/admin catch-all group, appended after every other flat row rather than
              inserted in the middle of the list, matching this app's established "append,
              don't renumber" precedent. Flag if a different spot reads better. */}
          {isOwner && (
            <div className="accordion-section nested">
              <button
                type="button"
                className="accordion-header nested"
                onClick={() => setOthersOpen((v) => !v)}
                aria-expanded={othersOpen}
              >
                <div className="accordion-header-text">
                  <div className="accordion-title-sm">Others</div>
                </div>
                <ChevronIcon className={othersOpen ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {othersOpen && (
                <div className="accordion-body nested">
                  {OTHERS_ITEMS.filter((item) => item.show(user)).map(({ to, label, Icon }) => (
                    <Link key={to} to={to} className="secondary-link-row">
                      <Icon size={18} />
                      <span>{label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button type="button" className="btn-secondary" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}
