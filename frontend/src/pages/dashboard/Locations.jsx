import { useEffect, useState } from 'react';
import { listLocations, getLocationsRevenue, updateLocationProfitShare } from '../../api/locations';

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
              stacked dash-cards. */}
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
          </div>

          {revenueError && (
            <p className="error-banner" role="alert">
              Could not load revenue: {revenueError}
            </p>
          )}

          {revenueStatus !== 'loaded' || !selectedLocationData ? (
            <p className="muted dash-empty">Loading…</p>
          ) : (
            <>
              {/* Profit share moved above the KPI grid, 2026-09-02 (layout only — same content/
                  logic as before, just relocated). */}
              <div className="dash-card">
                <h2 className="dash-section-title">Profit share — {selectedLocationData.locationName}</h2>
                <p className="muted">
                  What share of {selectedLocationData.locationName}'s profit actually belongs to the business.
                  Cost price is the same everywhere — only this percentage changes.
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
            </>
          )}
        </>
      )}
    </>
  );
}
