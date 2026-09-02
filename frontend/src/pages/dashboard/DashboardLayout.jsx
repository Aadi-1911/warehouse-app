import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useIdleTimer } from '../../hooks/useIdleTimer';
import PinPrompt from '../../components/PinPrompt';
import { verifyOwnPin } from '../../api/users';
import {
  GridIcon,
  ClipboardIcon,
  WarningTriangleIcon,
  UsersIcon,
  HistoryIcon,
  LocationPinIcon,
  TagIcon,
  WalletIcon,
  InvoiceIcon,
  FactoryIcon,
  ListIcon,
  LockIcon,
} from '../../components/icons';

// Owner Desktop Dashboard — layout shell (07_UI_DESIGN_BRIEF.md §8, design bundle
// "Owner Dashboard.dc.html").
//
// A DESKTOP-optimised surface that supplements, never replaces, the mobile app (§8's scope note,
// rule 15 — the owner also checks things from a phone). That's why this deliberately does NOT use
// the app's shared `.page` wrapper: `.page` is capped at 480px for the mobile-first screens, and a
// sidebar-plus-content dashboard inside a 480px column would be unusable. It gets its own
// full-viewport shell instead.
//
// The design's own header carries a "New order" button. It is deliberately NOT rendered here: the
// New Order dialog belongs to the future Orders task, and a button that looks real but does
// nothing is worse than no button — this project's own UI rule is that a control's presence has to
// mean something.
//
// === PIN LOCK (added 2026-08-21) ===
// A PRIVACY gate, explicitly not a security boundary. Every dashboard route is already
// requireRole('OWNER')-gated on the parent route AND on every underlying API endpoint, so STAFF
// can never reach any of this regardless of what the frontend renders. This lock exists for the
// legitimately-logged-in owner to blank his own screen from someone glancing over his shoulder.
//
// That framing is what justifies the design decisions here — and what stops them being mistaken
// for weak security later:
//   - Lock state lives in plain React state, NOT localStorage/sessionStorage. Persisting it would
//     be pointless (the data it hides is one un-gated API call away for anyone holding the
//     owner's token) and actively worse UX (a reload couldn't clear a stuck lock).
//   - Starting LOCKED on every fresh mount falls straight out of that: `useState(true)` with no
//     persistence means a reload, a re-entry from Home, or a new tab all start locked, with no
//     "was I unlocked before?" bookkeeping to get wrong.
//   - Unlocking issues no token and grants no new access — POST /api/users/me/verify-pin returns
//     a bare { ok: true } and this component flips a boolean.
//
// It wraps <Outlet/>, so it covers every dashboard page BY CONSTRUCTION — the same reason the
// OWNER role gate sits on the parent route rather than being repeated per page. A new dashboard
// page cannot ship un-locked any more than it can ship un-role-gated.
//
// The locked overlay stays ON the current route rather than redirecting to Overview/Home, so
// unlocking returns the owner to exactly the page (and URL) he was reading.

// 15 minutes. Kept as a named constant next to the state it governs rather than inlined, since
// this is the one number a future change is actually likely to want to touch.
const IDLE_LOCK_MS = 15 * 60 * 1000;

const NAV_ITEMS = [
  { to: '/dashboard', end: true, label: 'Overview', Icon: GridIcon },
  { to: '/dashboard/orders', label: 'Orders', Icon: ClipboardIcon },
  { to: '/dashboard/low-stock', label: 'Low stock', Icon: WarningTriangleIcon },
  { to: '/dashboard/parties', label: 'Parties', Icon: UsersIcon },
  { to: '/dashboard/history', label: 'History', Icon: HistoryIcon },
  // Added 2026-08-20, beyond §8's original 5-item nav — the location-attributed revenue/profit
  // split calculation task's own dashboard page. Appended at the end rather than inserted
  // mid-list, so it doesn't reshuffle the position of every existing nav item someone's already
  // used to clicking.
  { to: '/dashboard/locations', label: 'Locations', Icon: LocationPinIcon },
  // Added 2026-08-21, same "append beyond §8's original list, don't renumber it" precedent as
  // Locations right above. Same TagIcon the mobile Article Pricing screen already uses.
  { to: '/dashboard/article-pricing', label: 'Article Pricing', Icon: TagIcon },
  // Added 2026-08-26. Until now Factory Payables was reachable ONLY from the mobile Home screen,
  // so an owner working in the dashboard had no route to it at all without leaving the dashboard
  // first. Appended at the end for the third time running, following the same precedent Locations
  // and Article Pricing above both state explicitly: never renumber a nav someone already has
  // muscle memory for. Position is also right on its own terms — it sits next to Article Pricing,
  // the other money-side page, and after the day-to-day operational items (Orders, Low stock,
  // Parties, History) an owner opens far more often. Same WalletIcon the mobile Factory Payables
  // screen already uses, matching how Article Pricing reuses its own mobile TagIcon.
  { to: '/dashboard/factory-payables', label: 'Factory Payables', Icon: WalletIcon },
  // Added 2026-08-30, same "append at the end, never renumber" precedent as every addition
  // above. Same InvoiceIcon the mobile Bill Order screens already use for the same concept.
  { to: '/dashboard/bills', label: 'Bills', Icon: InvoiceIcon },
  // Added 2026-09-02, same "append at the end, never renumber" precedent as every addition
  // above. Unlike every other page in this list, Factories has no mobile equivalent to borrow an
  // icon from — Factory never had its own list/management screen anywhere before this page — so
  // FactoryIcon is a new glyph drawn specifically for this nav entry (see icons.jsx).
  { to: '/dashboard/factories', label: 'Factories', Icon: FactoryIcon },
  // Added 2026-09-02, same "append at the end, never renumber" precedent as every addition
  // above. Same ListIcon the mobile Live Stock screen already uses.
  { to: '/dashboard/live-stock', label: 'Live Stock', Icon: ListIcon },
];

// Page title + breadcrumb per route, keyed by the same paths NAV_ITEMS uses so a renamed route
// can't leave the header showing a stale title.
const PAGE_META = {
  '/dashboard': ['Wholesale overview', 'Overview'],
  '/dashboard/orders': ['All orders', 'Orders'],
  '/dashboard/low-stock': ['Stock below threshold', 'Low stock'],
  '/dashboard/parties': ['Customer accounts', 'Parties'],
  '/dashboard/history': ['Everything that happened', 'History'],
  '/dashboard/locations': ['Revenue and profit by location', 'Locations'],
  '/dashboard/article-pricing': ['Cost and selling price by article', 'Article Pricing'],
  '/dashboard/factory-payables': ['What we owe each factory', 'Factory Payables'],
  '/dashboard/bills': ['Every billed order, chronologically', 'Bills'],
  '/dashboard/factories': ['Supplier details, editable', 'Factories'],
  '/dashboard/live-stock': ['Stock on hand, by factory and article', 'Live Stock'],
};

function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [crumb, title] = PAGE_META[location.pathname] ?? ['', 'Dashboard'];

  const today = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  // Starts locked on every fresh mount — see the PIN LOCK note above for why that needs no
  // persistence to be correct.
  const [locked, setLocked] = useState(true);

  // Disabled while already locked: there's nothing to count down to, and leaving it running
  // would just fire a no-op re-lock. Re-arms the moment it unlocks.
  // `resetKey: location.pathname` makes NAVIGATION count as activity in its own right, not only
  // via the mousedown that happened to trigger it — the task lists navigation alongside
  // mouse/keys, and a keyboard-driven route change carries no mouse event at all.
  useIdleTimer({
    timeoutMs: IDLE_LOCK_MS,
    enabled: !locked,
    resetKey: location.pathname,
    onIdle: () => setLocked(true),
  });

  async function handleUnlock(pin) {
    // Throws on a wrong/locked-out PIN — PinPrompt catches it and renders the real server
    // message (INVALID_PIN + attempts remaining, PIN_LOCKED, PIN_NOT_SET), so none of that
    // behaviour is reimplemented here.
    await verifyOwnPin(pin);
    setLocked(false);
  }

  return (
    <div className="dash">
      <aside className="dash-rail">
        <div className="dash-rail-brand">
          <div className="dash-rail-logo">{initialsOf(user.name)}</div>
          <div className="dash-rail-brand-text">
            <div className="dash-rail-brand-name">{user.name}</div>
            <div className="dash-rail-brand-sub">Owner console</div>
          </div>
        </div>

        <nav className="dash-rail-nav">
          {NAV_ITEMS.map(({ to, end, label, Icon }) => (
            // NavLink rather than Link so the active row's highlight comes from the router's own
            // matching rather than a hand-rolled pathname comparison that could disagree with it.
            // `end` on Overview stops it staying highlighted on every nested /dashboard/* route.
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `dash-nav-link${isActive ? ' dash-nav-link-active' : ''}`}
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Back to the phone-shaped app. Without this the dashboard is a one-way door — every
            other screen in this app reaches Home via ScreenHeader, which this shell doesn't use. */}
        <NavLink to="/" className="dash-rail-exit">
          Back to the app
        </NavLink>
      </aside>

      <main className="dash-main">
        <header className="dash-header">
          <div>
            <div className="dash-header-crumb">{crumb}</div>
            <h1 className="dash-header-title">{title}</h1>
          </div>
          <div className="dash-header-right">
            <span className="dash-header-date">{today}</span>
            {/* Always rendered, never conditional on `locked` — the header stays visible behind
                the overlay, and a lock button that vanished exactly when the screen is locked
                would just be a hole where a control used to be. Disabled (not hidden) while
                locked, so its position never shifts. */}
            <button
              type="button"
              className="dash-lock-btn"
              onClick={() => setLocked(true)}
              disabled={locked}
              title={locked ? 'Dashboard is locked' : 'Lock the dashboard now'}
            >
              <LockIcon size={15} />
              <span>{locked ? 'Locked' : 'Lock'}</span>
            </button>
          </div>
        </header>

        {/* The content pane is always mounted, even while locked — blurred and inert behind the
            overlay rather than unmounted. Unmounting would throw away every child page's state
            (loaded data, expanded rows, the selected month/period/location) and refetch it all on
            unlock, turning a privacy blur into a full page reset. `inert` is what keeps that
            decision honest: the still-mounted content can't be focused, clicked or tabbed into
            while covered, so "visually hidden" and "actually unreachable" don't drift apart. */}
        <div className={`dash-content-wrap${locked ? ' dash-content-wrap-locked' : ''}`}>
          <div className={`dash-content${locked ? ' dash-content-locked' : ''}`} inert={locked}>
            <Outlet />
          </div>

          {locked && (
            <div className="dash-lock-overlay" role="dialog" aria-modal="true" aria-label="Dashboard locked">
              <div className="card dash-lock-card">
                <div className="dash-lock-mark">
                  <LockIcon size={22} />
                </div>
                <h2 className="dash-lock-title">Locked — enter PIN to view</h2>
                <p className="muted dash-lock-note">
                  Your figures are hidden. Enter your PIN to show this page again.
                </p>
                {user.hasPinSet ? (
                  <PinPrompt submitLabel="Unlock" submittingLabel="Unlocking…" autoFocus onSubmit={handleUnlock} />
                ) : (
                  // Reachable in one real case: an owner account created before PINs existed, or
                  // one whose PIN was never set. The dashboard would otherwise be permanently
                  // unopenable with no explanation, so this names the fix and links to it. The
                  // link leaves the dashboard entirely, which is fine — it's the only action
                  // available, and coming back re-locks anyway.
                  <p className="prompt-banner prompt-banner-warning dash-lock-nopin">
                    No PIN is set on your account yet. Set one from “Set PIN” in the app, then come
                    back to view the dashboard.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
