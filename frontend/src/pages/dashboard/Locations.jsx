import { useEffect, useRef, useState } from 'react';
import { listLocations, getLocationsRevenue, updateLocationProfitShare } from '../../api/locations';
import { PercentIcon } from '../../components/icons';
import DonutChart from '../../components/DonutChart';
import EChartsDonut from '../../components/EChartsDonut';

// Donut slice colours, in display order — see index.css's own --chart-lime/--chart-violet comment
// for the full collision check against every semantic/tile token already in use, including on
// this exact page (dash-kpi-purple, immediately below this donut). Cycles via modulo if a third
// location is ever added, rather than crashing on undefined — but only 2 colours exist today
// because only 2 locations exist today (see this file's own header comment); a real 3rd location
// would need a genuinely new colour picked with the same check, not just a silent 3rd cycle.
const DONUT_COLORS = ['var(--chart-lime)', 'var(--chart-violet)'];

// The three location-comparison donuts, in the same left-to-right order as the KPI grid above
// them (Stock value / Revenue / Profit) so donut N visually corresponds to KPI card N — same
// field names revenueData.locations already carries, no separate data shape per metric.
const DONUT_METRICS = [
  { key: 'stockValue', title: 'Stock value by location' },
  { key: 'revenue', title: 'Revenue by location' },
  { key: 'profit', title: 'Profit by location' },
];

// Owner Dashboard — Locations (added 2026-08-20, beyond 07_UI_DESIGN_BRIEF.md §8's original nav —
// the location-attributed revenue/profit split calculation task's own dashboard consumer).
//
// Pure UI over two already-built, already-verified pieces — no revenue/profit math lives here:
// utils/locationRevenue.js's locationRevenueForPeriod (via GET /api/locations/revenue) and
// PATCH /api/locations/:id/profit-share. Same reasoning the Parties page's sales summary already
// established: this page supplies a period name and a location toggle, the server computes.
//
// Investigated first, per the task: unlike Parties (2 real active out of 13, the rest leftover
// test fixtures), Location has NO test-fixture debris — exactly 2 rows total in the dev DB, both
// active, both real (Delhi, Gurgaon). The Parties precedent (filter to active only) is still
// applied here since it's the correct general rule regardless, but confirmed rather than assumed
// — this page would behave identically today with or without the isActive filter.
//
// The toggle is built from whatever active locations actually come back, not a hardcoded
// Delhi/Gurgaon pair — "Gurgaon as default" (an explicit, named product decision) is applied by
// matching on name once the real list loads, with a same-position fallback (first active
// location, alphabetically) if no location happens to be named exactly that. If more than 2
// active locations ever show up, this still renders correctly (the toggle just grows a third
// chip) — nothing here assumes exactly two.
//
// GET /api/locations/revenue returns EVERY location's figures in one call (see that endpoint's
// own comment for why) — toggling location is instant client-side, no refetch. Only a period
// change triggers a real request.
//
// Profit share AS A POPOVER (added 2026-09-02, presentation-only — no data/logic changes).
// Investigated first, per the task: DashboardLayout.jsx's <header> has no per-page action slot
// (dash-header-right is hardcoded to just the date + lock button, not exposed to child pages via
// children/context/an outlet prop), so there was no existing header slot to plug into — this
// page's own content is where the trigger button lives instead. Originally its own standalone
// row above Location/Period; moved into .dash-location-period-row itself as a third flex item
// (same day) so it reads as one coherent header-ish row instead of two stacked ones. For the
// popover's click-outside-to-close behaviour, this codebase already has an established, if
// uncentralized, pattern: Combobox.jsx and dashboard/Parties.jsx's own search box both close on
// an outside click via a containerRef + a `mousedown` document listener (checking
// `!containerRef.current.contains(e.target)`), each with its own inline copy rather than a
// shared hook. Followed here exactly rather than introducing a new shared hook, which would be
// its own separate refactor.
//
// profitShareDraft/profitShareSaving/profitShareError/profitShareSaved and
// handleSaveProfitShare below are completely UNTOUCHED by this — the popover only wraps their
// existing JSX in open/closed visibility. The "closes automatically after a successful save"
// requirement is met by a NEW, separate effect watching profitShareSaved (see below), not by
// editing handleSaveProfitShare itself — that function has no idea a popover exists.

const PERIOD_CHIPS = [
  { value: 'month', label: 'This month' },
  { value: 'six_months', label: 'Last 6 months' },
  { value: 'fy', label: 'This FY' },
  { value: 'all', label: 'All time' },
];

function inr(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`;
}

function inrShort(amount) {
  const n = Math.round(Number(amount));
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [locationsStatus, setLocationsStatus] = useState('idle');
  const [locationsError, setLocationsError] = useState(null);

  const [selectedLocationId, setSelectedLocationId] = useState(null);

  const [period, setPeriod] = useState('month');
  const [revenueData, setRevenueData] = useState(null); // { period, label, locations: [...] }
  const [revenueStatus, setRevenueStatus] = useState('idle');
  const [revenueError, setRevenueError] = useState(null);

  // null = not yet touched by the user for the currently-selected location; falls back to that
  // location's real server value below. Reset on location switch and after a successful save, so
  // the input always reflects a real number rather than a stale edit from a different location.
  const [profitShareDraft, setProfitShareDraft] = useState(null);
  const [profitShareSaving, setProfitShareSaving] = useState(false);
  const [profitShareError, setProfitShareError] = useState(null);
  const [profitShareSaved, setProfitShareSaved] = useState(false);

  // Popover open/closed state — entirely separate from the profit-share fields above, which know
  // nothing about it. Closed by default (rule: no popover ever starts open).
  const [profitSharePopoverOpen, setProfitSharePopoverOpen] = useState(false);
  const profitSharePopoverRef = useRef(null);

  // Click-outside-to-close — same containerRef + `mousedown` pattern Combobox.jsx/dashboard/
  // Parties.jsx's search box already use (see the file header comment). The ref wraps BOTH the
  // trigger button and the panel, so a click on the trigger itself never double-fires as an
  // "outside" click — the button's own onClick is what toggles it.
  useEffect(() => {
    if (!profitSharePopoverOpen) return;
    function handlePointerDown(e) {
      if (profitSharePopoverRef.current && !profitSharePopoverRef.current.contains(e.target)) {
        setProfitSharePopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [profitSharePopoverOpen]);

  // Auto-close on a successful save. Watches profitShareSaved rather than being called FROM
  // handleSaveProfitShare, so that function stays exactly as it was before this task — it has no
  // idea a popover exists, and doesn't need to.
  useEffect(() => {
    if (profitShareSaved) setProfitSharePopoverOpen(false);
  }, [profitShareSaved]);

  useEffect(() => {
    let cancelled = false;
    setLocationsStatus('loading');
    listLocations()
      .then((list) => {
        if (!cancelled) setLocations(list);
      })
      .catch((err) => {
        if (!cancelled) setLocationsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLocationsStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadRevenue(p) {
    setRevenueStatus('loading');
    setRevenueError(null);
    return getLocationsRevenue({ period: p })
      .then((data) => setRevenueData(data))
      .catch((err) => setRevenueError(err.message))
      .finally(() => setRevenueStatus('loaded'));
  }

  useEffect(() => {
    loadRevenue(period);
  }, [period]);

  const activeLocations = [...locations.filter((l) => l.isActive)].sort((a, b) => a.name.localeCompare(b.name));

  // Default selection, once locations have loaded and nothing is picked yet: Gurgaon by name if
  // present (the explicit "Gurgaon as default/primary view" decision), else the first active
  // location alphabetically — never a hardcoded id, so this still works if Gurgaon is ever
  // renamed or a differently-named set of locations exists.
  useEffect(() => {
    if (locationsStatus !== 'loaded' || selectedLocationId || activeLocations.length === 0) return;
    const gurgaon = activeLocations.find((l) => l.name === 'Gurgaon');
    setSelectedLocationId((gurgaon ?? activeLocations[0]).id);
  }, [locationsStatus, activeLocations.length]);

  function handleSelectLocation(id) {
    setSelectedLocationId(id);
    setProfitShareDraft(null);
    setProfitShareError(null);
    setProfitShareSaved(false);
  }

  const selectedLocationData = revenueData?.locations.find((l) => l.locationId === selectedLocationId) ?? null;
  const displayedProfitShare =
    profitShareDraft ?? (selectedLocationData ? String(selectedLocationData.profitSharePercent) : '');

  async function handleSaveProfitShare() {
    const value = Number(displayedProfitShare);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      setProfitShareError('Enter a whole number between 0 and 100.');
      return;
    }
    setProfitShareSaving(true);
    setProfitShareError(null);
    try {
      await updateLocationProfitShare(selectedLocationId, value);
      // Refetch rather than patching the figure locally — profit is revenue-minus-cost already
      // multiplied by the OLD share server-side; the only correct new profit figure is a fresh
      // server computation, not client-side reverse math off the previous multiplied result.
      await loadRevenue(period);
      setProfitShareDraft(null);
      setProfitShareSaved(true);
      setTimeout(() => setProfitShareSaved(false), 1500);
    } catch (err) {
      setProfitShareError(err.message);
    } finally {
      setProfitShareSaving(false);
    }
  }

  if (locationsStatus !== 'loaded') {
    return (
      <>
        {locationsError && (
          <p className="error-banner" role="alert">
            Could not load locations: {locationsError}
          </p>
        )}
        {!locationsError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {locationsError && (
        <p className="error-banner" role="alert">
          Could not refresh locations: {locationsError}
        </p>
      )}

      {activeLocations.length === 0 ? (
        <p className="muted dash-empty">No active locations yet.</p>
      ) : (
        <>
          {/* Location + Period side by side, added 2026-09-02 — each keeps its own label and
              chip-row markup exactly as before, just placed in a shared flex row instead of two
              stacked dash-cards. Profit share's popover trigger joined this row 2026-09-02 too
              (moved out of its own standalone .dash-page-actions row above this one) — a third
              flex item, right-aligned, sized to its own content rather than sharing the row's
              space with the two dash-cards (see .dash-location-period-row's own CSS comment for
              why it needs its own flex-basis rule to avoid stretching). */}
          <div className="dash-location-period-row">
            <div className="dash-card">
              <h2 className="dash-section-title">Location</h2>
              <div className="dash-location-toggle-row">
                {activeLocations.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    className={`chip${loc.id === selectedLocationId ? ' chip-selected' : ''}`}
                    onClick={() => handleSelectLocation(loc.id)}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="dash-card">
              <h2 className="dash-section-title">Period</h2>
              <div className="dash-location-toggle-row">
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
            </div>

            {/* Profit share popover trigger — page-local stand-in for a header action slot
                DashboardLayout.jsx's shared header doesn't expose (see the file header comment).
                position: relative here is deliberately scoped to JUST this wrapper, not the row
                (.dash-location-period-row itself stays position: static) — the popover panel
                below anchors to THIS element specifically, so its position: absolute must resolve
                against this wrapper's own box, not against the row (which would let the panel
                stretch to the row's full width or drift to the row's own top-left corner instead
                of sitting directly under the button). Disabled until a location's revenue data
                has actually loaded — nothing here can be edited before selectedLocationData
                exists anyway. */}
            <div className="dash-profit-share-popover-wrap" ref={profitSharePopoverRef}>
              <button
                type="button"
                className="dash-profit-share-trigger"
                onClick={() => setProfitSharePopoverOpen((v) => !v)}
                aria-label="Profit share settings"
                aria-expanded={profitSharePopoverOpen}
                disabled={!selectedLocationData}
              >
                <PercentIcon size={18} />
              </button>

              {/* Exact same content that used to sit in a standalone dash-card between the
                  Location/Period row and the KPI grid (two tasks ago) — only the wrapper and its
                  open/closed visibility changed, nothing inside it. */}
              {profitSharePopoverOpen && selectedLocationData && (
                <div className="dash-profit-share-popover">
                  <h2 className="dash-section-title">Profit share — {selectedLocationData.locationName}</h2>
                  <p className="muted">
                    What share of {selectedLocationData.locationName}'s profit actually belongs to the
                    business. Cost price is the same everywhere — only this percentage changes.
                  </p>
                  <div className="dash-location-profit-row">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="dash-location-profit-input"
                      value={displayedProfitShare}
                      onChange={(e) => setProfitShareDraft(e.target.value)}
                      disabled={profitShareSaving}
                    />
                    <span className="muted">%</span>
                    <button
                      type="button"
                      className="btn-primary btn-inline"
                      onClick={handleSaveProfitShare}
                      disabled={profitShareSaving}
                    >
                      {profitShareSaving ? 'Saving…' : 'Save'}
                    </button>
                    {profitShareSaved && <span className="dash-location-profit-saved">Saved</span>}
                  </div>
                  {profitShareError && (
                    <p className="error-banner" role="alert">
                      {profitShareError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {revenueError && (
            <p className="error-banner" role="alert">
              Could not load revenue: {revenueError}
            </p>
          )}

          {revenueStatus !== 'loaded' || !selectedLocationData ? (
            <p className="muted dash-empty">Loading…</p>
          ) : (
            <div className="dash-kpi-grid">
              <div className="dash-kpi dash-kpi-accent">
                <div className="dash-kpi-label">Stock value</div>
                <div className="dash-kpi-value">{inrShort(selectedLocationData.stockValue)}</div>
                <div className="dash-kpi-sub">{inr(selectedLocationData.stockValue)} at cost, right now</div>
              </div>
              <div className="dash-kpi dash-kpi-success">
                <div className="dash-kpi-label">Revenue</div>
                <div className="dash-kpi-value">{inrShort(selectedLocationData.revenue)}</div>
                <div className="dash-kpi-sub">billed + dispatched · {revenueData.label}</div>
              </div>
              <div className="dash-kpi dash-kpi-purple">
                <div className="dash-kpi-label">Profit</div>
                <div className="dash-kpi-value">{inrShort(selectedLocationData.profit)}</div>
                <div className="dash-kpi-sub">
                  {selectedLocationData.profitSharePercent}% share · {revenueData.label}
                </div>
              </div>
            </div>
          )}

          {/* Stock value / Revenue / Profit by location — a comparison across every location at
              once, added 2026-09-02 (moved below the KPI grid, expanded from just Stock value to
              all three metrics, and later given its own larger independent layout, same day).
              Deliberately unaffected by selectedLocationId/the chip toggle above — unlike the KPI
              grid immediately above, which narrows to ONE selected location, these three donuts
              always show ALL locations together, using revenueData.locations exactly as
              GET /api/locations/revenue already returns it (no new fetch, no dependency on
              selectedLocationData). Gated on revenueStatus/revenueData alone for that reason.
              Uses its own .dash-donut-grid, NOT .dash-kpi-grid — the two grids no longer need to
              align; see .dash-donut-grid's own comment in index.css for why that alignment was
              dropped on purpose. */}
          {revenueStatus === 'loaded' && revenueData && (
            <div className="dash-donut-grid">
              {DONUT_METRICS.map((metric) => {
                // DonutChart itself already excludes any slice with value <= 0 from the ring —
                // correct, and untouched here. What was missing is that the LEGEND still gave
                // every location a solid colour swatch regardless, implying a ring slice that
                // doesn't actually exist for a zero/negative location (e.g. Revenue/Profit, both
                // currently ₹0 for both locations — a solid swatch there falsely promises a
                // slice of colour that's really just the bare grey track). hiddenLocations drives
                // both the swatch variant below and the caption naming exactly which locations
                // and real values are missing from the ring.
                const hiddenLocations = revenueData.locations.filter((loc) => loc[metric.key] <= 0);
                return (
                  <div className="dash-card dash-donut-card" key={metric.key}>
                    <h2 className="dash-section-title">{metric.title}</h2>
                    <div className="dash-donut-legend-top">
                      {revenueData.locations.map((loc, i) => {
                        const onRing = loc[metric.key] > 0;
                        return (
                          <span key={loc.locationId} className="dash-donut-legend-item">
                            <span
                              className={`dash-donut-legend-swatch${onRing ? '' : ' dash-donut-legend-swatch-hidden'}`}
                              style={onRing ? { background: DONUT_COLORS[i % DONUT_COLORS.length] } : undefined}
                            />
                            <span className="dash-donut-legend-name">{loc.locationName}</span>
                            <span className="dash-donut-legend-value">{inr(loc[metric.key])}</span>
                          </span>
                        );
                      })}
                    </div>
                    <div className="dash-donut-center-wrap">
                      {/* Stock value only, deliberately (2026-09-03 echarts proof of concept) — this
                          is a partial, comparable state on purpose: Revenue/Profit stay on the
                          hand-rolled DonutChart below so Aadi can look at old vs new side by side
                          before three more charts and a new layout get built on the new library.
                          Same slices/centerLabel/description shape either way — only the component
                          rendering them differs. */}
                      {metric.key === 'stockValue' ? (
                        <EChartsDonut
                          size={180}
                          strokeWidth={46}
                          slices={revenueData.locations.map((loc, i) => ({
                            label: loc.locationName,
                            value: loc[metric.key],
                            color: DONUT_COLORS[i % DONUT_COLORS.length],
                          }))}
                          centerLabel={inrShort(revenueData.locations.reduce((sum, l) => sum + l[metric.key], 0))}
                          centerSubLabel="total"
                          description={`${metric.title}: ${revenueData.locations
                            .map((loc) => `${loc.locationName} ${inr(loc[metric.key])}`)
                            .join(', ')}`}
                          tooltipValueFormatter={inr}
                        />
                      ) : (
                        <DonutChart
                          size={180}
                          strokeWidth={46}
                          slices={revenueData.locations.map((loc, i) => ({
                            label: loc.locationName,
                            value: loc[metric.key],
                            color: DONUT_COLORS[i % DONUT_COLORS.length],
                          }))}
                          centerLabel={inrShort(revenueData.locations.reduce((sum, l) => sum + l[metric.key], 0))}
                          centerSubLabel="total"
                          description={`${metric.title}: ${revenueData.locations
                            .map((loc) => `${loc.locationName} ${inr(loc[metric.key])}`)
                            .join(', ')}`}
                        />
                      )}
                    </div>
                    {hiddenLocations.length > 0 && (
                      <p className="dash-donut-caption">
                        {hiddenLocations
                          .map((loc) => `${loc.locationName} not shown — ${inr(loc[metric.key])}`)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
