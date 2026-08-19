import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  GridIcon,
  ClipboardIcon,
  WarningTriangleIcon,
  UsersIcon,
  HistoryIcon,
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

const NAV_ITEMS = [
  { to: '/dashboard', end: true, label: 'Overview', Icon: GridIcon },
  { to: '/dashboard/orders', label: 'Orders', Icon: ClipboardIcon },
  { to: '/dashboard/low-stock', label: 'Low stock', Icon: WarningTriangleIcon },
  { to: '/dashboard/parties', label: 'Parties', Icon: UsersIcon },
  { to: '/dashboard/history', label: 'History', Icon: HistoryIcon },
];

// Page title + breadcrumb per route, keyed by the same paths NAV_ITEMS uses so a renamed route
// can't leave the header showing a stale title.
const PAGE_META = {
  '/dashboard': ['Wholesale overview', 'Overview'],
  '/dashboard/orders': ['All orders', 'Orders'],
  '/dashboard/low-stock': ['Stock below threshold', 'Low stock'],
  '/dashboard/parties': ['Customer accounts', 'Parties'],
  '/dashboard/history': ['Everything that happened', 'History'],
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
          <span className="dash-header-date">{today}</span>
        </header>

        <div className="dash-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
