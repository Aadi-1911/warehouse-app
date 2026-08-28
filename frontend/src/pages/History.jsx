import { useEffect, useState } from 'react';
import { HistoryIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import HistoryGroupingDrilldown from '../components/HistoryGroupingDrilldown';
import { listHistory } from '../api/history';
import { listLocations } from '../api/locations';
import { listFactories } from '../api/factories';
import { actorBadgeColorFor } from '../utils/avatar';
import {
  GROUP_MODES,
  buildDayGroups,
  entriesForPerson,
  entriesForLocation,
  entriesForMonth,
  entriesForBiweekly,
  entriesForBundleIds,
  filterByDateRange,
} from '../utils/historyGrouping';

// History — a unified, read-only feed of what's happened across Orders, Transfers and Good
// Returns, newest first. Reachable by both roles, and both see the identical feed (GET /api/history applies no
// role-based content filtering).
//
// Deliberately a utility screen for looking something up, not a dashboard: one flat
// reverse-chronological list by default, no charts. The only visual structure is a day header (so
// "when" is scannable without reading every timestamp) and a small per-type tag — plus, as of
// 2026-08-28, an optional "Group by" re-presentation of the SAME already-fetched list (see the
// GROUPING section below).
//
// The server sends a ready-made `description` for every entry, so this component never builds
// event copy itself. That's what keeps it generic: a new event type added server-side still
// renders correctly here, just with the fallback tag styling, rather than silently showing a
// blank row until the frontend is taught about it.
//
// === GROUPING (2026-08-28, bucketing rules extracted to utils/historyGrouping.js 2026-08-28
// when dashboard/History.jsx gained the same feature) ===
//
// A pure re-presentation of `entries`, entirely client-side — no new fetch, no change to what
// GET /api/history returns or to rule 104's actor-based filtering (that filtering already
// happened server-side before this component ever sees the array; grouping only decides how the
// SAME rows already in `entries` get bucketed on screen). Switching modes never re-sorts within a
// bucket: entries are pushed into their bucket in the array's own order, which is already
// newest-first from the server, so "newest-first inside each section" falls out for free rather
// than needing a second sort.
//
// The actual bucketing RULES (which entry goes in which bucket, under which mode — including the
// investigation into which entry types carry a real articleNo/location field, and the Transfer
// destination-bucketing judgment call) now live in utils/historyGrouping.js, shared with
// dashboard/History.jsx so the two screens' rules can't quietly drift apart. See that file's own
// comments for the full reasoning. This screen only imports them and handles its own rendering.
//
// === DRILL-DOWN (2026-08-29) ===
//
// Every mode except Chronological now asks for one SPECIFIC value (a person, a resolved article,
// a location, a month, a bi-weekly period) plus an optional date range, before showing anything —
// replacing the old "every bucket at once, scrollable" behaviour, which Aadi flagged as not going
// to stay usable as History grows. Chronological is deliberately untouched: it still just renders
// every day, no picker. <HistoryGroupingDrilldown> (shared with dashboard/History.jsx) owns the
// picker widgets themselves; this file only holds the "which value is currently picked" state and
// derives the final filtered list via historyGrouping.js's entriesForX functions, then re-uses
// buildDayGroups on THAT narrowed list — the exact same day-sub-header rendering Chronological
// already had, just fed a smaller array. See HistoryGroupingDrilldown.jsx's own header comment for
// why Article's resolution goes through a Product's bundleIds rather than a bare articleNo string.

// Badge COLOUR per type. Colours follow 07_UI_DESIGN_BRIEF.md §3.4's own semantic role table
// rather than being picked freely: Order = purple, forward progress = success/green, a
// correction = warning/amber, stock movement = accent/blue.
//
// The tag's TEXT is deliberately not in here — it comes from entry.label, computed server-side.
// A static per-type mapping could only ever produce one word per type, which meant all three of
// Packed/Billed/Dispatched rendered an identical generic "Status" tag and the actual moment was
// buried in the description. The three still share ORDER_STATUS's green (they're all forward
// progress); only the wording distinguishes them.
const TYPE_BADGE_CLASSES = {
  ORDER_PLACED: 'badge-purple',
  ORDER_STATUS: 'badge-success',
  ORDER_ADJUSTMENT: 'badge-warning',
  TRANSFER: 'badge-accent',
  // Warning/amber, sharing ORDER_ADJUSTMENT's colour rather than TRANSFER's: §3.4 assigns amber
  // to "something went differently than planned," which is what a return is. A transfer is
  // routine internal movement (accent/blue) — physically similar, semantically not the same event.
  GOOD_RETURN: 'badge-warning',
  // Receive Stock receipts and their corrections (added 2026-08-21) — same colour split as above:
  // a receipt is routine stock movement (accent, like TRANSFER), a correction is amber (like
  // ORDER_ADJUSTMENT/GOOD_RETURN). Both roles see these entries — only the Owner Dashboard's own
  // History page (rule 70) renders a Correct action on top of them; this screen stays read-only.
  RECEIPT: 'badge-accent',
  RECEIPT_CORRECTION: 'badge-warning',
  // Transfer Corrections (added the same day) — same amber role as every other correction type.
  TRANSFER_CORRECTION: 'badge-warning',
};

// Unknown types still render — see the component comment above.
const FALLBACK_BADGE_CLASS = 'badge-accent';
const FALLBACK_LABEL = 'Event';

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

// One entry's row markup — extracted so the default day-grouped view and every "Group by" mode
// render an IDENTICAL row rather than two hand-copied versions that could drift the first time
// either is touched (the same reasoning Live Stock's renderFactorySection was extracted for).
function HistoryEntryRow({ entry }) {
  const badgeClass = TYPE_BADGE_CLASSES[entry.type] ?? FALLBACK_BADGE_CLASS;
  const actorColor = actorBadgeColorFor(entry.actorName);
  return (
    <div className="history-row">
      <div className="history-row-top">
        <span className={`badge ${badgeClass}`}>{entry.label ?? FALLBACK_LABEL}</span>
        <span className="muted history-row-time">{formatTime(entry.timestamp)}</span>
      </div>
      <p className="history-row-description">{entry.description}</p>
      <p className="history-row-actor">
        <span
          className="badge history-actor-badge"
          style={{ background: actorColor.bg, color: actorColor.text }}
        >
          {entry.actorName}
        </span>
      </p>
    </div>
  );
}

// One labelled section (a heading plus a card of rows) — reused for a day heading AND for every
// "Group by" section. The classnames still say "day" (history-day/history-day-heading/
// history-day-card) for a plain reason: dashboard/History.jsx's own separate day-grouping copy
// already depends on those exact names (its own header comment says it borrows this screen's CSS
// classes so the two surfaces can't drift on what a day boundary means), so renaming them here
// would risk that file too, for a change scoped to THIS screen only. The rule itself was already
// generic — "an eyebrow label above a padded card of rows" — nothing about it is day-specific,
// which is what makes reusing it for a Person/Article/Location section correct rather than a
// misuse of a differently-named class.
//
// `heading` is a node, not a string, so Person grouping can pass the actual coloured actor badge
// (reusing history-actor-badge, the exact same pill each row's own actor line already renders)
// instead of plain text — this is the literal "reuses actorName and its existing colour-coded
// name-badge... as the section header" requirement, not a re-derived look-alike.
function HistorySection({ sectionKey, heading, entries }) {
  return (
    <div className="history-day">
      <div className="eyebrow history-day-heading">{heading}</div>
      <div className="card history-day-card">
        {entries.map((entry) => (
          <HistoryEntryRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

export default function History() {
  const [entries, setEntries] = useState([]);
  // Explicit status, never a bare boolean — an empty feed must be distinguishable from one that
  // hasn't loaded yet, or the screen would flash "Nothing recorded yet" before the fetch returns.
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  // 'chronological' is the default per this task's own spec — the existing day-grouped view,
  // completely unchanged in behaviour. The other five modes now drill down to one specific value
  // (see DRILL-DOWN section above) before showing anything.
  const [groupMode, setGroupMode] = useState('chronological');

  // Locations/Factories — needed only by the drill-down controls (Location's dropdown, Article's
  // disambiguation chip labels), fetched once up front the same non-fatal way dashboard/History.jsx
  // already fetches them for its own correction form: a failure here shouldn't block the main feed,
  // it would just leave those two pickers with nothing until a retry succeeds.
  const [locations, setLocations] = useState([]);
  const [factories, setFactories] = useState([]);

  // --- Drill-down selection state. `drillValue` holds the picked Person/Location/Month/Bi-weekly
  // value (a plain string); Article is separate (`articleBundleIds`) because what actually filters
  // entries for Article is a resolved Product's bundleIds, not the typed string itself — see
  // HistoryGroupingDrilldown's header comment. All four reset together on every mode switch so a
  // stale selection from one mode can never silently carry into another.
  const [drillValue, setDrillValue] = useState(null);
  const [articleBundleIds, setArticleBundleIds] = useState(null);
  // True for exactly the gap between picking a specific article and its bundleIds actually
  // arriving (a real GET /api/products/:id/valid-colors round-trip) — see
  // HistoryGroupingDrilldown's own comment for why this can't just be inferred from
  // articleBundleIds staying null.
  const [articleResolving, setArticleResolving] = useState(false);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');

  function handleGroupModeChange(mode) {
    setGroupMode(mode);
    setDrillValue(null);
    setArticleBundleIds(null);
    setArticleResolving(false);
    setDateStart('');
    setDateEnd('');
  }

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    listHistory()
      .then((list) => {
        if (!cancelled) setEntries(list);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listLocations(), listFactories()])
      .then(([locs, facs]) => {
        if (cancelled) return;
        setLocations(locs);
        setFactories(facs);
      })
      .catch(() => {
        // Non-fatal — see the state declarations' own comment above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group into day sections purely for display — logic lives in utils/historyGrouping.js. Used
  // as-is for Chronological (every day, no drill-down); every other mode instead narrows `entries`
  // down to the picked value first (drilldownEntries below) and re-uses this SAME function on that
  // smaller array, which is what still gives every drilled-down result its own day sub-headers.
  const days = groupMode === 'chronological' ? buildDayGroups(entries) : [];

  // The picked-value narrowing for every non-Chronological mode. `null` specifically means "no
  // value picked yet" (as opposed to `[]`, a real value picked with zero matching entries) — that
  // distinction is what tells the render below whether to show the "pick a value" prompt or an
  // actual "nothing matches" empty state.
  let drilldownEntries = null;
  if (groupMode === 'person' && drillValue) drilldownEntries = entriesForPerson(entries, drillValue);
  else if (groupMode === 'location' && drillValue) drilldownEntries = entriesForLocation(entries, drillValue);
  else if (groupMode === 'month' && drillValue) drilldownEntries = entriesForMonth(entries, drillValue);
  else if (groupMode === 'biweekly' && drillValue) drilldownEntries = entriesForBiweekly(entries, drillValue);
  else if (groupMode === 'article' && articleBundleIds) drilldownEntries = entriesForBundleIds(entries, articleBundleIds);

  const finalEntries = drilldownEntries ? filterByDateRange(drilldownEntries, dateStart, dateEnd) : null;
  const finalDayGroups = finalEntries ? buildDayGroups(finalEntries) : [];

  return (
    <div className="page">
      {/* tone="tile-grey" (2026-08-27) matches Home's History tile exactly, per Aadi's confirmed
          tap-a-tile/land-on-that-colour continuity — was unset (ScreenHeader's own default,
          accent-blue). No same-page collision: none of this page's own entry-type badges
          (purple/success/warning/accent) or actor badges (accent/indigo/teal/rose) use grey. */}
      <ScreenHeader icon={<HistoryIcon size={20} />} tone="tile-grey" title="History" />

      {error && (
        <p className="error-banner" role="alert">
          Could not load history: {error}
        </p>
      )}

      {/* Always rendered, even on an empty/loading feed — the control itself doesn't depend on
          there being anything to group, and leaving the chosen mode selected while the page is
          empty avoids the control silently resetting itself underneath someone. */}
      <label className="field">
        <span className="field-label">Group by</span>
        <select value={groupMode} onChange={(e) => handleGroupModeChange(e.target.value)}>
          {GROUP_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {groupMode !== 'chronological' && (
        <HistoryGroupingDrilldown
          key={groupMode}
          groupMode={groupMode}
          entries={entries}
          locations={locations}
          factories={factories}
          selectedValue={drillValue}
          onSelectValue={setDrillValue}
          onArticleResolved={({ bundleIds }) => setArticleBundleIds(bundleIds)}
          onArticleResolvingChange={setArticleResolving}
          onArticleCleared={() => setArticleBundleIds(null)}
          dateStart={dateStart}
          dateEnd={dateEnd}
          onDateStartChange={setDateStart}
          onDateEndChange={setDateEnd}
        />
      )}

      {status !== 'loaded' ? (
        <p className="muted centered-empty-state">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted centered-empty-state">Nothing recorded yet.</p>
      ) : groupMode === 'chronological' ? (
        days.map((day) => (
          <HistorySection key={day.heading} heading={day.heading} entries={day.entries} />
        ))
      ) : groupMode === 'article' && articleResolving ? (
        <p className="muted centered-empty-state">Loading…</p>
      ) : finalEntries === null ? (
        <p className="muted centered-empty-state">Pick a value above to see its history.</p>
      ) : finalDayGroups.length === 0 ? (
        <p className="muted centered-empty-state">No entries match this filter.</p>
      ) : (
        finalDayGroups.map((day) => (
          <HistorySection key={day.heading} heading={day.heading} entries={day.entries} />
        ))
      )}
    </div>
  );
}
