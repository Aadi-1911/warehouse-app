// Shared "Group by" bucketing rules for History — used by BOTH the mobile-facing History.jsx and
// the owner-only dashboard/History.jsx. Split out on 2026-08-28 when the dashboard screen gained
// the same grouping feature mobile shipped first: the two screens render entries very differently
// (dashboard's rows carry Correct affordances tied to a pile of local component state; mobile's
// don't), but WHICH bucket a given entry falls into under WHICH mode is a single set of rules that
// must never drift between them. Keeping that logic here, imported by both, makes drift a merge
// conflict instead of a silent inconsistency. Rendering (row markup, section markup) stays
// per-file on purpose — see each file's own render code for why.
//
// Purely functional: every export here takes the already-fetched `entries` array (or one entry)
// and returns data, never touches the DOM/React/network. That's what let this logic get verified
// with a standalone Node script against synthetic entries during the original mobile build, for
// the one real-data gap (GOOD_RETURN/RECEIPT_CORRECTION/TRANSFER_CORRECTION) — see
// [[pure functions and testability]] in LEARNING_LOG.md.

// Display order (2026-08-28: Month/Bi-weekly added) — Chronological moved last on purpose, per
// Aadi's own ordering for this change. Doesn't affect the DEFAULT selected mode, which each screen
// still hardcodes as 'chronological' in its own useState — this array only controls the <select>'s
// option order.
export const GROUP_MODES = [
  { value: 'person', label: 'Person' },
  { value: 'article', label: 'Article' },
  { value: 'location', label: 'Location' },
  { value: 'month', label: 'Month' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'chronological', label: 'Chronological' },
];

// Order-level entries can legitimately span several articles at once (an order has many line
// items) — bucketing under any ONE article would either duplicate the entry across every article
// it touches, or arbitrarily pick one and hide the rest. So these three get their own named
// bucket instead of the generic fallback — "Order events" is accurate, not a data-missing excuse.
export const ORDER_LEVEL_TYPES = new Set(['ORDER_PLACED', 'ORDER_STATUS', 'ORDER_ADJUSTMENT']);

// Two distinct fallback buckets, not one catch-all: ORDER_EVENTS_KEY is for types that don't have
// A SINGLE article/location by nature (order-level); OTHER_KEY is for types that simply don't
// carry the field today (GOOD_RETURN, RECEIPT_CORRECTION, TRANSFER_CORRECTION). Kept separate so
// "Order events" stays literally accurate rather than becoming a catch-all that also holds an
// unrelated Good Return.
export const OTHER_KEY = '__OTHER__';
export const ORDER_EVENTS_KEY = '__ORDER_EVENTS__';

// Which article a given entry belongs to, for Article grouping. Confirmed by reading every
// entries.push(...) in historyController.js: only TRANSFER and RECEIPT carry a real `articleNo`
// field. Everything else mentions an article only inside the server-built `description` string —
// parsing that back out would be exactly the event-copy-building this feed's own design avoids
// (fragile besides: a future wording change would silently break grouping with no error).
export function articleGroupFor(entry) {
  if (entry.articleNo) return { key: entry.articleNo, label: entry.articleNo };
  if (ORDER_LEVEL_TYPES.has(entry.type)) return { key: ORDER_EVENTS_KEY, label: 'Order events' };
  return { key: OTHER_KEY, label: 'Other' };
}

// Which location a given entry belongs to, for Location grouping.
//
// TRANSFER is the one type with two real locations (from and to); this picks the DESTINATION
// deliberately, not arbitrarily — a Transfer's arrival leg is the same kind of event a RECEIPT
// already represents for this purpose (stock becoming newly present at a location), so picking
// the destination keeps one consistent rule across both stock-movement types. The origin leg
// isn't lost from the feed, only from this one bucket — it's still visible under every other
// grouping mode and in the entry's own description ("Gurgaon → Delhi"). A defensible case exists
// for the origin instead; this is a judgment call, confirmed as correct as-is, not the only
// possible answer.
export function locationGroupFor(entry) {
  if (entry.type === 'RECEIPT') return { key: entry.locationName, label: entry.locationName };
  if (entry.type === 'TRANSFER') return { key: entry.toLocationName, label: entry.toLocationName };
  return { key: OTHER_KEY, label: 'Other' };
}

// Shared by Article and Location grouping. Buckets in first-seen order (== newest-first, since
// that's `entries`' own server-sorted order), then sorts real buckets alphabetically by label with
// fallback bucket(s) pinned after them — a fallback is a "didn't fit elsewhere" catch-all, not a
// place name or article number, so alphabetical position among real buckets would be meaningless.
export function buildGroups(entries, groupFor) {
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
      // Fixed relative order between the two fallbacks, not alphabetical (which would put "Order
      // events" before "Other" only by coincidence of spelling) — Order events reads as the more
      // substantial category of the two, so it comes first among fallbacks.
      return a.key === ORDER_EVENTS_KEY ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}

// Person grouping needs no fallback bucket (every entry type already carries actorName, confirmed
// the same way as above) and no key/label split — the actor's own name is both. Kept as its own
// function rather than routed through buildGroups, since buildGroups' fallback-pinning logic has
// nothing to do here.
export function buildPersonGroups(entries) {
  const buckets = new Map();
  entries.forEach((entry) => {
    if (!buckets.has(entry.actorName)) buckets.set(entry.actorName, []);
    buckets.get(entry.actorName).push(entry);
  });
  return [...buckets.entries()]
    .map(([actorName, entryList]) => ({ actorName, entries: entryList }))
    .sort((a, b) => a.actorName.localeCompare(b.actorName));
}

// Chronological (default) grouping — a day heading whenever the calendar day changes from the
// previous entry. The server already sorts newest-first, so this only inserts headings, never
// re-sorts. Shared because both screens' "Today"/"Yesterday" wording must agree, same as every
// other bucketing rule here.
export function formatDayHeading(iso) {
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

// Shared by every CALENDAR-PERIOD grouping mode (Chronological/day, Month, Bi-weekly) — as opposed
// to buildGroups above, which buckets by a named entity (an article number, a location) and then
// sorts those buckets alphabetically. A calendar period has no such "name" to sort by; it only has
// a position in time, and `entries` is already newest-first from the server, so walking the array
// once and starting a new bucket whenever `headingFor` changes is both correct and the cheapest
// option — no Map, no second sort. This is exactly what buildDayGroups did inline before Month/
// Bi-weekly needed the identical shape; factored out here so those two reuse the SAME walk rather
// than copying it, per this file's own anti-drift purpose (see header comment).
export function buildPeriodGroups(entries, headingFor) {
  const periods = [];
  entries.forEach((entry) => {
    const heading = headingFor(entry.timestamp);
    const last = periods[periods.length - 1];
    if (!last || last.heading !== heading) {
      periods.push({ heading, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  });
  return periods;
}

export function buildDayGroups(entries) {
  return buildPeriodGroups(entries, formatDayHeading);
}

// Month grouping — "August 2026", newest month first (falls out of `entries`' own server order,
// same as every other period grouping here). Full month name, not abbreviated, to read as a
// standalone section heading rather than a compact inline date.
export function formatMonthHeading(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function buildMonthGroups(entries) {
  return buildPeriodGroups(entries, formatMonthHeading);
}

// Bi-weekly grouping — semi-monthly calendar halves: 1st-15th, and 16th-to-end-of-month. The
// second half's end date is computed per month length (not hardcoded 30/31) via the
// "day 0 of next month" trick, which also correctly yields 28 or 29 for February without a special
// case. Abbreviated month name here (unlike Month's full name) to keep the heading compact — it
// already carries a day range, so it reads as a date range rather than a section title.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatBiweeklyHeading(iso) {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = d.getMonth();
  const monthAbbr = MONTH_ABBR[month];
  if (d.getDate() <= 15) return `1–15 ${monthAbbr} ${year}`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return `16–${lastDay} ${monthAbbr} ${year}`;
}

export function buildBiweeklyGroups(entries) {
  return buildPeriodGroups(entries, formatBiweeklyHeading);
}

// === DRILL-DOWN (2026-08-29) ===
//
// Every mode except Chronological now asks for a SPECIFIC value before showing anything, rather
// than rendering every bucket at once — Chronological alone stays a plain scroll of every day, per
// Aadi's own explicit carve-out. These five functions narrow `entries` down to exactly the slice
// for one picked value; the day-sub-headers within that slice still come from buildDayGroups
// (called separately, by whichever screen renders the result) — narrowing WHICH entries are in
// play and grouping-by-day WITHIN them are two different concerns, and this file keeps them that
// way rather than fusing them into one combined function per mode.
//
// Each of these is a thin wrapper around an ALREADY-EXISTING grouping rule above (buildPersonGroups,
// locationGroupFor, formatMonthHeading, formatBiweeklyHeading) rather than a second, separate
// definition of "which entries match this value" — the exact anti-drift reasoning this file's own
// header comment already states for the bucketing rules themselves. A future change to, say,
// locationGroupFor's TRANSFER-destination convention automatically applies here too, with nothing
// to keep in sync by hand.

export function entriesForPerson(entries, actorName) {
  return buildPersonGroups(entries).find((g) => g.actorName === actorName)?.entries ?? [];
}

export function entriesForLocation(entries, locationName) {
  return entries.filter((e) => locationGroupFor(e).key === locationName);
}

export function entriesForMonth(entries, monthHeading) {
  return buildMonthGroups(entries).find((g) => g.heading === monthHeading)?.entries ?? [];
}

export function entriesForBiweekly(entries, biweeklyHeading) {
  return buildBiweeklyGroups(entries).find((g) => g.heading === biweeklyHeading)?.entries ?? [];
}

// Article is the one drill-down that can't be keyed off `entry.articleNo` directly — articleNo is
// only unique PER FACTORY (05_BUSINESS_RULES.md rule 54), and this app has a real live example of
// the same number existing under two different Factories with real history entries under both
// (confirmed directly against the database before writing this: articleNo "6099" is both Comeco's
// "ad" and RDX's "Balenciaga", each with real Transfer/Receipt history). Matching on the string
// alone would silently merge two unrelated articles' history into one filtered view. `bundleId` is
// what actually disambiguates — it already identifies one specific (Factory, article, colour)
// combination, and both entry types that carry a real articleNo (TRANSFER, RECEIPT) also already
// carry their own `bundleId`. The caller resolves the typed article number to one specific Product
// first (reusing New Order's own exact-match/disambiguation flow — see
// components/HistoryGroupingDrilldown.jsx), then fetches that Product's own bundleIds
// (GET /api/products/:id/valid-colors, the same call New Order/Receive Stock already make) and
// passes them in here. Entry types that don't carry a bundleId (ORDER_*, GOOD_RETURN, the two
// *_CORRECTION types) simply never match any real id, so they're excluded automatically — no
// special-case check needed, matching this file's own existing OTHER_KEY/ORDER_EVENTS_KEY
// reasoning that those types don't belong under one specific article to begin with.
export function entriesForBundleIds(entries, bundleIds) {
  const idSet = new Set(bundleIds);
  return entries.filter((e) => idSet.has(e.bundleId));
}

// Optional start/end date narrowing, applied on top of whichever of the five functions above ran
// first (or usable standalone). Both bounds are calendar-day inclusive in the VIEWER'S OWN LOCAL
// time zone — `startDate`/`endDate` are the plain 'YYYY-MM-DD' strings an `<input type="date">`
// produces; parsing them with an explicit local T00:00:00/T23:59:59.999 (rather than letting
// `new Date('YYYY-MM-DD')` parse as UTC midnight, which JS does for date-only ISO strings) is what
// keeps this consistent with formatDayHeading's own Today/Yesterday logic and formatBiweeklyHeading's
// day-of-month reads, both of which already work in local time — a UTC-parsed boundary would
// silently shift by the viewer's UTC offset and could exclude/include the wrong day near midnight.
// Either bound may be omitted (empty string/undefined) for an open-ended range on that side.
export function filterByDateRange(entries, startDate, endDate) {
  if (!startDate && !endDate) return entries;
  const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : -Infinity;
  const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity;
  return entries.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= startMs && t <= endMs;
  });
}

// Year narrowing for Month/Bi-weekly ONLY (2026-08-30) — these are the two drill-down modes whose
// own option list grows unboundedly with time (a new month, and two new bi-weekly periods, every
// single month forever); Person/Location have a fixed-ish roster that doesn't grow with time the
// same way, and Article is a direct lookup rather than a browsed list, so none of those three get
// this extra step. Asking for a year FIRST keeps the Month/Bi-weekly dropdown itself small no
// matter how many years of history accumulate.
//
// Derived from `entry.timestamp` directly (`new Date(...).getFullYear()`), never by parsing a
// year back out of an already-formatted heading string — the exact kind of fragile round-trip
// this file's own header comment already avoids for `description` text, for the same reason: a
// heading's wording is free to change independently of what the underlying data actually is.
export function yearOptionsFor(entries) {
  const years = new Set(entries.map((e) => new Date(e.timestamp).getFullYear()));
  return [...years].sort((a, b) => b - a); // newest year first, matching every other option list here
}

export function entriesForYear(entries, year) {
  return entries.filter((e) => new Date(e.timestamp).getFullYear() === year);
}
