import { useEffect, useState } from 'react';
import { listOrders } from '../../api/orders';
import { buildMonthGroups, entriesForMonth, entriesForYear, yearOptionsFor } from '../../utils/historyGrouping';

// Owner Dashboard — Bills (added 2026-08-30, beyond 07_UI_DESIGN_BRIEF.md §8's original nav —
// same "append at the end, don't renumber" precedent Locations/Article Pricing/Factory Payables
// already established in DashboardLayout.jsx).
//
// Pure fetch-and-display: a flat, chronological list of every billed order, one row each,
// S.No/Party/Bill No/Amount/Date. Zero new computation, zero new schema — every column comes
// straight off one already-existing, any-role endpoint, GET /api/orders (unfiltered) — the SAME
// endpoint dashboard/Orders.jsx already trusts.
//
// No Location column (removed 2026-08-30, was Party.location on the first pass). Order itself
// carries no per-order FULFILLMENT location at all — the `Location` model is physical warehouses
// (Delhi/Gurgaon), and rule 210 (05_BUSINESS_RULES.md) explicitly documents why a single order
// can't be attributed to one warehouse (fulfillment can span locations via FIFO-at-billing, rule
// 64) without inventing an allocation rule. Party.location (the party's own city, a genuinely
// different concept — where the CUSTOMER is, not where the goods shipped from) isn't what was
// actually asked for, so showing it would be a misleading substitute rather than a real answer.
// Real per-order warehouse attribution is a follow-up task if that ever gets tracked, not this one.
//
// `billNo` needs no special handling here despite being OWNER-only on read (orderController.js's
// orderDetailSelect/listOrders): this page only ever renders inside the OWNER-gated /dashboard
// route (App.jsx's parent-route requireRole), so every fetch this page makes is already an OWNER
// request and the field is always present when this component runs at all.
//
// === Month/Year view (added 2026-08-30) ===
// Chronological stays the default and only mode until "Month" is picked — same "an added mode,
// not a replacement" shape History's own Group-by toggle already established. Bills has no
// Person/Article/Location dimension the way History does (an order has exactly one party, not a
// pile of independently-groupable actors/articles/locations), so Month is the only extra mode —
// no GROUP_MODES-style array needed for just two options.
//
// Deliberately reuses utils/historyGrouping.js's yearOptionsFor/entriesForYear/buildMonthGroups/
// entriesForMonth UNCHANGED rather than writing parallel date-bucketing logic — those functions
// only ever read `entry.timestamp` and bucket by calendar period, so they have no dependency on
// History's own entry shape (actorName/articleNo/etc.), and duplicating "which calendar month
// does this date fall in" a second time is exactly the copy-that-silently-diverges bug class this
// project has hit before (see historyGrouping.js's own header comment). The only adaptation is
// `billsAsEntries` below, which aliases each order's `billedAt` to a `timestamp` key — a plain
// property rename, not new bucketing logic — because these orders don't carry a field literally
// named `timestamp`.
//
// Same two-step Year-then-Month shape History's own Month drill-down uses (and for the identical
// reason, stated on yearOptionsFor's own comment): Bills will keep growing a new month every
// month forever, so asking for a year first keeps the Month dropdown itself from growing without
// bound.
//
// === 15+ days badge (added 2026-08-30) ===
// A small pill next to the Date value, never a tinted row — this app deliberately moved away from
// full-row colour fills toward small flags only (see LEARNING_LOG.md, "Why low-stock is a small
// badge, never a fully-tinted card": a fully-tinted row trains people to tune out the colour over
// time, and a small flag stays meaningful precisely because it's rare). Reuses `badge-warning`,
// the same colour role Pack Order's own short-pack state already uses — not a new colour, and not
// `badge-danger` (Low Stock's own choice, but a different signal: this isn't flagging a problem to
// fix, just a plain fact about elapsed time). No severity tiers — a bill at 16 days and one at 90
// days get the identical badge, same single-threshold principle Low Stock's own badge already
// uses ("a row at 0 sets looks the same as a row at 1 set, both simply flagged").
//
// Copy is "15+ days", not "Overdue" — there's no real due-date/payment-status system built yet
// (Bills has no due date, no payment-tracking of its own), so implying one with "Overdue"-style
// language would claim something this screen doesn't actually track.

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const OVERDUE_FLAG_DAYS = 15;

// Local-midnight day count — same convention historyGrouping.js's own formatDayHeading already
// establishes (comparing calendar-day components in the viewer's own local time, never a raw
// millisecond subtraction, which would misfire near midnight against the viewer's UTC offset).
// Both sides are normalized to local midnight first, so what's compared is whole calendar days
// elapsed, not partial days.
function daysSinceBilled(billedAtIso) {
  const billed = new Date(billedAtIso);
  const billedMidnight = new Date(billed.getFullYear(), billed.getMonth(), billed.getDate());
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayMidnight - billedMidnight) / 86400000);
}

export default function DashboardBills() {
  const [orders, setOrders] = useState([]);
  // 'idle' | 'loading' | 'loaded' — never a bare boolean, same discipline as every other
  // mount-fetching dashboard screen.
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState(null);

  // 'chronological' | 'month' — Chronological is the default, matching History's own convention.
  const [viewMode, setViewMode] = useState('chronological');
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    listOrders()
      .then((orderList) => {
        if (cancelled) return;
        setOrders(orderList);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Switching view modes always starts the Month step clean — same reasoning
  // HistoryGroupingDrilldown's own handleYearChange gives for clearing the narrower selection
  // whenever the broader one changes, applied one level up here (mode itself, not just year).
  function handleViewModeChange(value) {
    setViewMode(value);
    setSelectedYear(null);
    setSelectedMonth(null);
  }

  function handleYearChange(value) {
    setSelectedYear(value ? Number(value) : null);
    setSelectedMonth(null);
  }

  if (status !== 'loaded') {
    return (
      <>
        {loadError && (
          <p className="error-banner" role="alert">
            Could not load bills: {loadError}
          </p>
        )}
        {!loadError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  // "Every billed Order" (billedAt set) — includes SHIPPED orders too, since billedAt stays set
  // once an order moves on to Shipped (rule 59's chain never clears an earlier stage timestamp).
  // No isCancelled filter needed: cancelOrder only allows Placed/Packed (rule 23 locks a billed
  // order), so a row with billedAt set can never be cancelled — that combination can't occur.
  //
  // Most-recent-first on billedAt specifically, NOT the list's own createdAt-desc order — an
  // order created later can still be billed earlier than one created before it (packing/billing
  // pace differs order to order), so this needs its own explicit sort rather than trusting the
  // fetch order to already match.
  const bills = orders
    .filter((o) => o.billedAt != null)
    .sort((a, b) => new Date(b.billedAt) - new Date(a.billedAt));

  // The one adaptation needed to reuse historyGrouping.js's period functions unchanged — they
  // read `entry.timestamp`, and an order's own date field is named `billedAt`. `...order` keeps
  // every original field (partyName, billNo, totalValue, id) riding along, so the result of
  // entriesForMonth below is still directly renderable exactly like `bills` itself.
  const billsAsEntries = bills.map((order) => ({ ...order, timestamp: order.billedAt }));

  const yearOptions = viewMode === 'month' ? yearOptionsFor(billsAsEntries) : [];
  const monthOptions =
    viewMode === 'month' && selectedYear
      ? buildMonthGroups(entriesForYear(billsAsEntries, selectedYear)).map((g) => g.heading)
      : [];

  // Chronological shows everything; Month shows nothing until a specific month is actually picked
  // — same "prompt for a specific value, don't dump every bucket at once" shape History's own
  // drill-down uses, rather than a scrollable list of every month.
  const visibleBills =
    viewMode === 'chronological'
      ? bills
      : selectedMonth
        ? entriesForMonth(billsAsEntries, selectedMonth)
        : null;

  return (
    <>
      {loadError && (
        <p className="error-banner" role="alert">
          Could not refresh bills: {loadError}
        </p>
      )}

      {/* Always rendered once loaded, even on an empty feed — same reasoning
          dashboard/History.jsx's own Group-by control gives for never hiding the mode picker. */}
      <div className="dash-bills-controls">
        <label className="field">
          <span className="field-label">View</span>
          <select value={viewMode} onChange={(e) => handleViewModeChange(e.target.value)}>
            <option value="chronological">Chronological</option>
            <option value="month">Month</option>
          </select>
        </label>

        {viewMode === 'month' && (
          <label className="field">
            <span className="field-label">Year</span>
            <select value={selectedYear ?? ''} onChange={(e) => handleYearChange(e.target.value)}>
              <option value="">Select a year…</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}

        {viewMode === 'month' && selectedYear && (
          <label className="field">
            <span className="field-label">Month</span>
            <select value={selectedMonth ?? ''} onChange={(e) => setSelectedMonth(e.target.value || null)}>
              <option value="">Select a month…</option>
              {monthOptions.map((heading) => (
                <option key={heading} value={heading}>
                  {heading}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {bills.length === 0 ? (
        <p className="muted dash-empty">No bills yet.</p>
      ) : visibleBills === null ? (
        <p className="muted dash-empty">Pick a year and month above to see that month's bills.</p>
      ) : visibleBills.length === 0 ? (
        <p className="muted dash-empty">No bills in this month.</p>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="dash-bills-table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Party Name</th>
                  <th>Bill No.</th>
                  <th className="dash-bills-num">Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {visibleBills.map((order, index) => (
                  <tr key={order.id}>
                    <td className="dash-bills-sno">{index + 1}</td>
                    <td>{order.partyName}</td>
                    {/* Older bills legitimately have no billNo — it didn't exist before
                        2026-08-30 — shown as "—", never filtered out (the task's own instruction:
                        show every billed order regardless of whether it carries a tag). */}
                    <td>{order.billNo || <span className="muted">—</span>}</td>
                    <td className="dash-bills-num">{formatCurrency(order.totalValue)}</td>
                    <td>
                      <div className="dash-bills-date-cell">
                        <span>{formatDate(order.billedAt)}</span>
                        {daysSinceBilled(order.billedAt) > OVERDUE_FLAG_DAYS && (
                          <span className="badge badge-warning">15+ days</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
