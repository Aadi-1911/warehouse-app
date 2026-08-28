import { useEffect, useState } from 'react';
import { HistoryIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listHistory } from '../api/history';
import { actorBadgeColorFor } from '../utils/avatar';

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
// === GROUPING (2026-08-28) ===
//
// A pure re-presentation of `entries`, entirely client-side — no new fetch, no change to what
// GET /api/history returns or to rule 104's actor-based filtering (that filtering already
// happened server-side before this component ever sees the array; grouping only decides how the
// SAME rows already in `entries` get bucketed on screen). Switching modes never re-sorts within a
// bucket: entries are pushed into their bucket in the array's own order, which is already
// newest-first from the server, so "newest-first inside each section" falls out for free rather
// than needing a second sort.
//
// Investigated before building rather than assumed: only TRANSFER and RECEIPT entries carry a
// structured `articleNo`/location field today (confirmed by reading every `entries.push(...)` in
// historyController.js directly). ORDER_PLACED/ORDER_STATUS/ORDER_ADJUSTMENT, GOOD_RETURN,
// RECEIPT_CORRECTION and TRANSFER_CORRECTION all mention an article or location only INSIDE their
// pre-built `description` string — never as a field on the entry object. Parsing that string back
// out to recover structured data would be exactly the kind of event-copy-building this component
// deliberately avoids (see the header comment above), and brittle besides — a future wording
// change to the description would silently break grouping with no error. So those types fall into
// a named fallback bucket for Article/Location grouping instead of being mis-grouped or dropped.
// Exposing those fields server-side is a small, worthwhile follow-up if finer-grained grouping for
// them turns out to matter in practice — not done here, since this task is scoped to re-presenting
// what's already fetched, not changing what's fetched.
const GROUP_MODES = [
  { value: 'chronological', label: 'Chronological' },
  { value: 'person', label: 'Person' },
  { value: 'article', label: 'Article' },
  { value: 'location', label: 'Location' },
];

// Order-level entries can legitimately span several articles at once (an order has many line
// items) — bucketing them under any ONE article would either duplicate the entry across every
// article it touches (which the task explicitly rules out, and which would make the same order
// placement appear to happen several times) or arbitrarily pick just one and hide the others. So
// these three types get their own named bucket instead, distinct from the generic fallback below
// — "Order events" is an accurate description of what they are, not a concession for missing data.
const ORDER_LEVEL_TYPES = new Set(['ORDER_PLACED', 'ORDER_STATUS', 'ORDER_ADJUSTMENT']);

// The fallback bucket for a type with no structured article/location field, for a reason OTHER
// than being order-level (GOOD_RETURN, RECEIPT_CORRECTION, TRANSFER_CORRECTION today) — kept
// separate from ORDER_EVENTS_KEY so "Order events" stays literally accurate rather than becoming
// a catch-all that also holds an unrelated Good Return.
const OTHER_KEY = '__OTHER__';
const ORDER_EVENTS_KEY = '__ORDER_EVENTS__';

// Which article a given entry belongs to, for Article grouping. Returns a { key, label } pair
// rather than a bare string so a fallback bucket's key (stable, for Map lookups) and its display
// label (human-readable) can differ.
function articleGroupFor(entry) {
  if (entry.articleNo) return { key: entry.articleNo, label: entry.articleNo };
  if (ORDER_LEVEL_TYPES.has(entry.type)) return { key: ORDER_EVENTS_KEY, label: 'Order events' };
  return { key: OTHER_KEY, label: 'Other' };
}

// Which location a given entry belongs to, for Location grouping.
//
// TRANSFER is the one type with two real locations (from and to), and this bucketing picks the
// DESTINATION deliberately, not arbitrarily: a Transfer's arrival leg is the same kind of event a
// RECEIPT already represents for this purpose — stock becoming newly present at a location — so
// picking the destination keeps one consistent rule across both stock-movement types ("Group by
// Location" shows what a location received). The origin leg isn't lost from the feed, only from
// this one bucket; it's still fully visible under Chronological, Person, or Article grouping, and
// in the entry's own description text ("Gurgaon → Delhi") wherever it's shown. This is a judgment
// call where an equally defensible case exists for the origin instead — flagging it explicitly
// rather than presenting it as the only possible answer.
function locationGroupFor(entry) {
  if (entry.type === 'RECEIPT') return { key: entry.locationName, label: entry.locationName };
  if (entry.type === 'TRANSFER') return { key: entry.toLocationName, label: entry.toLocationName };
  return { key: OTHER_KEY, label: 'Other' };
}

// Shared by Article and Location grouping (Person needs no fallback — every entry type already
// carries actorName, confirmed by reading every entries.push(...) in historyController.js, so
// there's nothing to fall back from). Buckets in first-seen order (which is newest-first, since
// that's `entries`' own order), then sorts real buckets alphabetically by label with any fallback
// bucket(s) pinned after them — a fallback is a "didn't fit elsewhere" catch-all, not a place name
// or article number, so alphabetical position among real ones would be meaningless at best and
// misleading at worst (e.g. "Order events" sorting before "AK Knitwear" purely because "O" > "A"
// says nothing about actual relevance).
function buildGroups(entries, groupFor) {
  const buckets = new Map();
  entries.forEach((entry) => {
    const { key, label } = groupFor(entry);
    if (!buckets.has(key)) buckets.set(key, { key, label, entries: [] });
    buckets.get(key).entries.push(entry);
  });

  const isFallback = (key) => key === OTHER_KEY || key === ORDER_EVENTS_KEY;
  return [...buckets.values()].sort((a, b) => {
    if (isFallback(a.key) !== isFallback(b.key)) return isFallback(a.key) ? 1 : -1;
    if (isFallback(a.key) && isFallback(b.key)) {
      // Fixed relative order between the two possible fallbacks, not alphabetical (which would
      // put "Order events" before "Other" only by coincidence of spelling) — Order events reads
      // as the more substantial category of the two, so it comes first among fallbacks.
      return a.key === ORDER_EVENTS_KEY ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}

// Badge COLOUR per type. Colours follow 07_UI_DESIGN_BRIEF.md §3.4's own semantic role table
// rather than being picked freely: Order = purple, forward progress = success/green, a
// correction = warning/amber, stock movement = accent/blue.
//
// The tag's TEXT is deliberately not in here — it comes from entry.label, computed server-side.
// A static per-type mapping could only ever produce one word per type, which meant all three of
// Packed/Billed/Shipped rendered an identical generic "Status" tag and the actual moment was
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

function formatDayHeading(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
  // completely unchanged in behaviour. The other three modes re-bucket the SAME `entries` array;
  // switching between all four never triggers a re-fetch.
  const [groupMode, setGroupMode] = useState('chronological');

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

  // Group into day sections purely for display. The server already sorted everything newest-first,
  // so this preserves that order rather than re-sorting — it only inserts a heading whenever the
  // calendar day changes from the previous entry. Only built/used when groupMode is
  // 'chronological' — the default and only mode with a genuinely different SHAPE of grouping
  // (nested under a calendar boundary, not a single flat bucket list).
  const days = [];
  entries.forEach((entry) => {
    const heading = formatDayHeading(entry.timestamp);
    const last = days[days.length - 1];
    if (!last || last.heading !== heading) {
      days.push({ heading, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  });

  // Person grouping needs no fallback bucket (every entry type already carries actorName) and no
  // article/location-style key/label split — the actor's own NAME is both, and the heading is the
  // coloured badge itself rather than plain text (built inline below, not via buildGroups, since
  // buildGroups' fallback-pinning logic has nothing to do here).
  const personGroups =
    groupMode === 'person'
      ? (() => {
          const buckets = new Map();
          entries.forEach((entry) => {
            if (!buckets.has(entry.actorName)) buckets.set(entry.actorName, []);
            buckets.get(entry.actorName).push(entry);
          });
          return [...buckets.entries()]
            .map(([actorName, entryList]) => ({ actorName, entries: entryList }))
            .sort((a, b) => a.actorName.localeCompare(b.actorName));
        })()
      : [];

  const articleGroups = groupMode === 'article' ? buildGroups(entries, articleGroupFor) : [];
  const locationGroups = groupMode === 'location' ? buildGroups(entries, locationGroupFor) : [];

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
        <select value={groupMode} onChange={(e) => setGroupMode(e.target.value)}>
          {GROUP_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {status !== 'loaded' ? (
        <p className="muted centered-empty-state">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted centered-empty-state">Nothing recorded yet.</p>
      ) : groupMode === 'chronological' ? (
        days.map((day) => (
          <HistorySection key={day.heading} heading={day.heading} entries={day.entries} />
        ))
      ) : groupMode === 'person' ? (
        personGroups.map((group) => (
          <HistorySection
            key={group.actorName}
            heading={
              // The exact same pill each row's own actor line renders — see HistorySection's own
              // comment for why this satisfies "reuses... existing colour-coded name-badge" as
              // literally as possible, rather than a new, similar-but-different header style.
              <span
                className="badge history-actor-badge"
                style={{
                  background: actorBadgeColorFor(group.actorName).bg,
                  color: actorBadgeColorFor(group.actorName).text,
                }}
              >
                {group.actorName}
              </span>
            }
            entries={group.entries}
          />
        ))
      ) : groupMode === 'article' ? (
        articleGroups.map((group) => (
          <HistorySection key={group.key} heading={group.label} entries={group.entries} />
        ))
      ) : (
        locationGroups.map((group) => (
          <HistorySection key={group.key} heading={group.label} entries={group.entries} />
        ))
      )}
    </div>
  );
}
