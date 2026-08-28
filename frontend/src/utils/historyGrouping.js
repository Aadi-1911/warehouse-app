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

export const GROUP_MODES = [
  { value: 'chronological', label: 'Chronological' },
  { value: 'person', label: 'Person' },
  { value: 'article', label: 'Article' },
  { value: 'location', label: 'Location' },
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

export function buildDayGroups(entries) {
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
  return days;
}
