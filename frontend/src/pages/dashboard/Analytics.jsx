import { useEffect, useState } from 'react';
import { getFactoriesRevenue } from '../../api/factories';
import OfficialPieChart from '../../components/OfficialPieChart';

// Owner Dashboard — Analytics (added 2026-09-05, beyond 07_UI_DESIGN_BRIEF.md §8's original nav
// — same "append at the end, don't renumber" precedent every prior addition since Locations has
// established).
//
// Factories tab: revenue-by-factory doughnut, wired to the already-tested
// GET /api/factories/analytics/revenue (utils/factoryRevenue.js). Parties tab is still a pure
// placeholder — that's later work, once it's clear what a Parties-side analytics view even needs
// to show (this page has no Parties-side backend to call yet at all).
//
// The chart itself is OfficialPieChart.jsx, a brand new component built for this task
// specifically — see its own header for why it deliberately shares nothing with
// EChartsDonut.jsx/Locations.jsx (Option A: real echarts emphasis + built-in legend, not a
// custom HTML center label).
const TABS = [
  { value: 'factories', label: 'Factories' },
  { value: 'parties', label: 'Parties' },
];

// Same four options, same labels, as Locations.jsx's own PERIOD_CHIPS — duplicated locally
// rather than imported, per this task's boundary against touching or importing anything from
// Locations.jsx. Same precedent as piecesPerSet.js's own frontend/backend duplication: two
// independent copies of a tiny, stable constant beat a cross-boundary import that isn't allowed
// here anyway.
const PERIOD_CHIPS = [
  { value: 'month', label: 'This month' },
  { value: 'six_months', label: 'Last 6 months' },
  { value: 'fy', label: 'This FY' },
  { value: 'all', label: 'All time' },
];

// Local ₹ formatter, same shape as Locations.jsx's own `inr` helper — independently written, not
// imported, for the same reason PERIOD_CHIPS above is duplicated rather than shared.
function inr(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`;
}

export default function Analytics() {
  const [tab, setTab] = useState('factories');

  // Defaults to 'all' rather than Locations.jsx's 'month' default — real revenue is currently 0
  // across every factory for recent periods in the dev DB (confirmed in the prior backend task),
  // so 'all' is the period actually most likely to show a real, non-empty chart today.
  const [period, setPeriod] = useState('all');

  // 'idle' | 'loading' | 'loaded' — never a bare boolean, same discipline as every other
  // mount-fetching dashboard screen (LiveStock.jsx, Locations.jsx, Bills.jsx all follow this).
  const [revenueData, setRevenueData] = useState(null); // { period, label, factories: [...] }
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    getFactoriesRevenue({ period })
      .then((data) => {
        if (!cancelled) setRevenueData(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  // Non-positive-revenue factories excluded from the chart entirely — same convention
  // EChartsDonut.jsx already established for Locations (a factory at ₹0 gets no slice, not a
  // hairline sliver). Archived factories are INCLUDED here, same as Locations includes archived
  // locations: an inactive factory can still hold real historical revenue, and dropping it would
  // understate the real figure. Flagging per the task: this is applying established convention,
  // not a fresh judgment call — worth a second look once real archived-factory data exists to see
  // whether an archived factory showing up in a current-period revenue chart actually reads as
  // sensible to an owner, or just confusing.
  const chartFactories = (revenueData?.factories ?? []).filter((f) => f.revenue > 0);
  const chartData = chartFactories.map((f) => ({ name: f.factoryName, value: f.revenue }));

  function renderFactoriesTab() {
    if (status !== 'loaded') {
      return (
        <>
          {error && (
            <p className="error-banner" role="alert">
              Could not load factory revenue: {error}
            </p>
          )}
          {!error && <p className="muted dash-empty">Loading…</p>}
        </>
      );
    }

    if (error) {
      return (
        <p className="error-banner" role="alert">
          Could not refresh factory revenue: {error}
        </p>
      );
    }

    if (chartData.length === 0) {
      return <p className="muted dash-empty">No revenue in this period yet.</p>;
    }

    return (
      <OfficialPieChart
        data={chartData}
        radius={['40%', '70%']}
        seriesName="Revenue by factory"
        valueFormatter={inr}
        description={`Revenue by factory, ${revenueData.label}: ${chartData
          .map((d) => `${d.name} ${inr(d.value)}`)
          .join(', ')}`}
      />
    );
  }

  return (
    <div className="dash-card">
      <h2 className="dash-section-title">View</h2>
      {/* Same chip/chip-selected button styling Locations.jsx's own Period/Location selectors
          use, not underline tabs — this app has exactly one "pick one of a few options" control
          style and this switcher is that same kind of control. The row itself is NOT
          .dash-location-toggle-row: that class's properties (flex, wrap, gap, padding-top) are
          entirely generic, but its NAME is location-specific, and this switcher has nothing to do
          with Location. Rather than reuse a misleadingly-named class on an unrelated screen,
          .dash-tab-row exists as an identical-properties twin under a name that describes what
          it's actually for — see its definition in index.css, right next to
          .dash-location-toggle-row's own. */}
      <div className="dash-tab-row">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`chip${tab === t.value ? ' chip-selected' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'factories' && (
        <>
          <h2 className="dash-section-title">Period</h2>
          <div className="dash-tab-row">
            {PERIOD_CHIPS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip${period === c.value ? ' chip-selected' : ''}`}
                onClick={() => setPeriod(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {renderFactoriesTab()}
        </>
      )}

      {tab === 'parties' && <p className="muted dash-empty">Charts coming soon.</p>}
    </div>
  );
}
