import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDashboardOverview } from '../../api/dashboard';
import { listHistory } from '../../api/history';

// Owner Dashboard — Overview (07_UI_DESIGN_BRIEF.md §8, design bundle "Owner Dashboard.dc.html").
//
// Six KPI cards plus a recent-activity feed. Every figure is computed server-side, fresh, on every
// load — there is no caching anywhere in the chain (rules 60, 81, 96, 98 all establish this for
// the project's other computed money figures).
//
// The card COLOURS are not decorative. §3.4's semantic role table assigns Stock value blue (a
// computed financial figure, same accent the Factory Payables hero uses), Low stock red (danger),
// Revenue green (success/positive); Sets and Pieces are neutral because they're counts, not money.
// The three pipeline/volume cards added 2026-09-01 (Awaiting billing, Awaiting dispatch, Orders
// this week — labels renamed 2026-09-01 from Packed not billed / Billed not shipped, display text
// only, the underlying data fields are unchanged) sit outside the original brief's palette — see
// index.css's own comment beside --fuchsia-* for the real hue-distance numbers behind picking
// Indigo/Purple/Fuchsia for them.
//
// Card ORDER (2026-09-01): fixed at Stock value / Sets in stock / Pieces in stock / Revenue on row
// 1, Low stock / Awaiting dispatch / Awaiting billing / Orders this week on row 2 — a deliberate
// choice, not the order these cards were originally built in, so don't infer meaning from the JSX
// declaration order elsewhere in this file (there isn't any left; the elements below are declared
// in this exact visual order, not reordered via CSS).
//
// The design's three "extras" widgets (top parties, stock value by location, low-stock preview)
// are deliberately absent — explicitly deferred by this task's scope.

const REVENUE_PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'fy', label: 'This FY' },
  { value: 'all', label: 'All time' },
];

// Indian digit grouping (1,03,780 not 103,780) — this is what the owner reads on every other money
// figure in the app, so the dashboard must not invent a different one.
function inr(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`;
}

// Compact form for the big KPI numerals, so a crore-scale figure can't overflow a 196px card.
// The full precise figure is always still shown on the card's secondary line.
function inrShort(amount) {
  const n = Math.round(Number(amount));
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function formatCount(n) {
  return Number(n).toLocaleString('en-IN');
}

function formatWhen(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(
    'en-IN',
    { hour: 'numeric', minute: '2-digit' }
  )}`;
}

export default function Overview() {
  const [data, setData] = useState(null);
  // Explicit status, never a bare boolean — an empty dashboard must be distinguishable from one
  // that hasn't fetched yet, or the KPI row flashes zeros before the real figures land. Zeros are
  // an especially bad thing to flash here: they're plausible-looking money.
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const [revenuePeriod, setRevenuePeriod] = useState('fy');
  // Separate from `status` so changing the Revenue selector doesn't blank the whole KPI row —
  // the previous figures stay on screen, dimmed, while the new one is computed.
  const [revenueBusy, setRevenueBusy] = useState(false);

  const [activity, setActivity] = useState([]);
  const [activityStatus, setActivityStatus] = useState('idle');
  const [activityError, setActivityError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Only the very first load blanks the cards; later period changes swap `revenueBusy` instead.
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    setRevenueBusy(true);
    setError(null);
    getDashboardOverview({ revenuePeriod })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setStatus('loaded');
        setRevenueBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revenuePeriod]);

  useEffect(() => {
    let cancelled = false;
    setActivityStatus('loading');
    setActivityError(null);
    // GET /api/history unchanged — it already returns exactly the shape this feed needs
    // (timestamp, actor, ready-made description), so this builds no event copy of its own.
    listHistory()
      .then((list) => {
        if (!cancelled) setActivity(list.slice(0, 12));
      })
      .catch((err) => {
        if (!cancelled) setActivityError(err.message);
      })
      .finally(() => {
        if (!cancelled) setActivityStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status !== 'loaded' && !data) {
    return (
      <>
        {error && (
          <p className="error-banner" role="alert">
            Could not load the dashboard: {error}
          </p>
        )}
        {!error && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          Could not refresh the dashboard: {error}
        </p>
      )}

      <div className="dash-kpi-grid">
        {/* 1. Stock value — blue. costPrice basis (rule 69: inventory cost, deliberately NOT the
            same field as Revenue). costPrice is stored per PIECE, so the server multiplies through
            piecesPerSet — the same three-factor basis rule 81 uses for the factory payable, so the
            two owner-facing money figures agree about what a unit of stock is worth. */}
        <div className="dash-kpi dash-kpi-accent">
          <div className="dash-kpi-label">Stock value</div>
          <div className="dash-kpi-value">{inrShort(data.stockValue)}</div>
          <div className="dash-kpi-sub">{inr(data.stockValue)} at cost</div>
        </div>

        <div className="dash-kpi">
          <div className="dash-kpi-label">Sets in stock</div>
          <div className="dash-kpi-value">{formatCount(data.setsInStock)}</div>
          <div className="dash-kpi-sub dash-kpi-sub-muted">
            {formatCount(data.bundlesWithStock)} article / colour line
            {data.bundlesWithStock === 1 ? '' : 's'}
          </div>
        </div>

        <div className="dash-kpi">
          <div className="dash-kpi-label">Pieces in stock</div>
          <div className="dash-kpi-value">{formatCount(data.piecesInStock)}</div>
          {/* The design hard-codes "4 pc per set". That's only true for one article shape, and this
              business mixes 3, 4 and Kids articles at 4/5/6 — so this states the real conversion
              actually applied rather than a number that would quietly be wrong. */}
          <div className="dash-kpi-sub dash-kpi-sub-muted">
            real pieces-per-set, per article
          </div>
        </div>

        {/* 4. Revenue — green. sellingPrice basis, Billed + Shipped only (rules 69 and 98).
            Changing the selector re-requests the figure from the server rather than switching
            between values fetched earlier, so it genuinely recomputes. */}
        <div className={`dash-kpi dash-kpi-success${revenueBusy ? ' dash-kpi-busy' : ''}`}>
          <div className="dash-kpi-label-row">
            <span className="dash-kpi-label">Revenue</span>
            <select
              className="dash-kpi-select"
              value={revenuePeriod}
              onChange={(e) => setRevenuePeriod(e.target.value)}
              aria-label="Revenue period"
            >
              {REVENUE_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="dash-kpi-value">{inrShort(data.revenue)}</div>
          <div className="dash-kpi-sub">billed + dispatched · {data.revenueLabel}</div>
        </div>

        {/* 5. Low stock — red, and a real link. Rule 56's ≤1 threshold, counted server-side so this
            card and Live Stock can't drift apart on what "low" means. The destination is still a
            placeholder for now, which is fine: the card's job is to point somewhere true. */}
        <Link to="/dashboard/low-stock" className="dash-kpi dash-kpi-danger dash-kpi-link">
          <div className="dash-kpi-label">Low stock</div>
          <div className="dash-kpi-value">{formatCount(data.lowStockCount)}</div>
          <div className="dash-kpi-sub">
            {/* Plural-aware since the threshold is no longer hardcoded at a plural value (it was
                always "2 sets" before 2026-08-26; now it's genuinely 1) — found by actually
                reading the rendered KPI after lowering the threshold, not assumed safe. */}
            lines at or below {data.lowStockThreshold} set{data.lowStockThreshold === 1 ? '' : 's'} →
          </div>
        </Link>

        {/* 6. Awaiting dispatch — purple, reused from the retired Open Orders card (2026-09-01):
            a real conflict check against the final 8-card set found it still clears every other
            card's colour by a comfortable margin (see index.css's --fuchsia-* comment). Money
            already claimed at billing, sitting in the pipe until it goes out the door. Label
            renamed 2026-09-01 from "Billed not shipped" — display text only, still backed by
            data.billedNotShippedCount/Value (backend field names unchanged). */}
        <div className="dash-kpi dash-kpi-purple">
          <div className="dash-kpi-label">Awaiting dispatch</div>
          <div className="dash-kpi-value">{formatCount(data.billedNotShippedCount)}</div>
          <div className="dash-kpi-sub">{inrShort(data.billedNotShippedValue)} billed, awaiting dispatch</div>
        </div>

        {/* 7. Awaiting billing — indigo. Stock already deducted at packing, payment not yet
            claimed. Same actualPayable-preferred basis as every other order-value figure on this
            screen (rule 103), though every order reachable here is pre-billing so the preference
            always takes the live line-item fallback in practice (dashboardController.js's own
            comment says as much). Label renamed 2026-09-01 from "Packed not billed" — display
            text only, still backed by data.packedNotBilledCount/Value (backend field names
            unchanged). */}
        <div className="dash-kpi dash-kpi-indigo">
          <div className="dash-kpi-label">Awaiting billing</div>
          <div className="dash-kpi-value">{formatCount(data.packedNotBilledCount)}</div>
          <div className="dash-kpi-sub">{inrShort(data.packedNotBilledValue)} packed, not yet billed</div>
        </div>

        {/* 8. Orders this week — fuchsia, a new dedicated token (index.css). Plain volume count,
            no value: Monday-start calendar week, includes cancelled orders on purpose — this is a
            general/reporting count, not an actionable worklist, matching the same distinction
            orderController.js's listOrders already draws between an unfiltered query (returns
            everything, cancelled included) and a status-scoped worklist (excludes cancelled). */}
        <div className="dash-kpi dash-kpi-fuchsia">
          <div className="dash-kpi-label">Orders this week</div>
          <div className="dash-kpi-value">{formatCount(data.ordersThisWeek)}</div>
          <div className="dash-kpi-sub">since Monday</div>
        </div>
      </div>

      <section>
        <div className="dash-section-head">
          <h2 className="dash-section-title">Recent activity</h2>
          <Link to="/dashboard/history" className="dash-section-link">
            Full history →
          </Link>
        </div>

        <div className="dash-card">
          {activityError && (
            <p className="error-banner" role="alert">
              Could not load activity: {activityError}
            </p>
          )}
          {activityStatus !== 'loaded' ? (
            <p className="muted dash-empty">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="muted dash-empty">Nothing recorded yet.</p>
          ) : (
            activity.map((entry) => (
              <div key={entry.id} className="dash-activity-row">
                <span className="dash-activity-kind">{entry.label}</span>
                <span className="dash-activity-text">{entry.description}</span>
                <span className="dash-activity-who">{entry.actorName}</span>
                <span className="dash-activity-when">{formatWhen(entry.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
