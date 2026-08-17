import { useEffect, useState } from 'react';
import { HistoryIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listHistory } from '../api/history';

// History — a unified, read-only feed of what's happened across Orders and Transfers, newest
// first. Reachable by both roles, and both see the identical feed (GET /api/history applies no
// role-based content filtering).
//
// Deliberately a utility screen for looking something up, not a dashboard: one flat
// reverse-chronological list, no charts, no filters, no grouping. The only visual structure is a
// day header (so "when" is scannable without reading every timestamp) and a small per-type tag.
//
// The server sends a ready-made `description` for every entry, so this component never builds
// event copy itself. That's what keeps it generic: a new event type added server-side still
// renders correctly here, just with the fallback tag styling, rather than silently showing a
// blank row until the frontend is taught about it.

// Tag label + badge class per type. Colours follow 07_UI_DESIGN_BRIEF.md §3.4's own semantic role
// table rather than being picked freely: Order = purple, forward progress = success/green,
// a correction = warning/amber, stock movement = accent/blue.
const TYPE_TAGS = {
  ORDER_PLACED: { label: 'Order', className: 'badge-purple' },
  ORDER_STATUS: { label: 'Status', className: 'badge-success' },
  ORDER_ADJUSTMENT: { label: 'Change', className: 'badge-warning' },
  TRANSFER: { label: 'Transfer', className: 'badge-accent' },
};

// Unknown types still render — see the component comment above.
const FALLBACK_TAG = { label: 'Event', className: 'badge-accent' };

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

export default function History() {
  const [entries, setEntries] = useState([]);
  // Explicit status, never a bare boolean — an empty feed must be distinguishable from one that
  // hasn't loaded yet, or the screen would flash "Nothing recorded yet" before the fetch returns.
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

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
  // calendar day changes from the previous entry.
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

  return (
    <div className="page">
      <ScreenHeader icon={<HistoryIcon size={20} />} title="History" />

      {error && (
        <p className="error-banner" role="alert">
          Could not load history: {error}
        </p>
      )}

      {status !== 'loaded' ? (
        <p className="muted centered-empty-state">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="muted centered-empty-state">Nothing recorded yet.</p>
      ) : (
        days.map((day) => (
          <div key={day.heading} className="history-day">
            <div className="eyebrow history-day-heading">{day.heading}</div>
            <div className="card history-day-card">
              {day.entries.map((entry) => {
                const tag = TYPE_TAGS[entry.type] ?? FALLBACK_TAG;
                return (
                  <div key={entry.id} className="history-row">
                    <div className="history-row-top">
                      <span className={`badge ${tag.className}`}>{tag.label}</span>
                      <span className="muted history-row-time">{formatTime(entry.timestamp)}</span>
                    </div>
                    <p className="history-row-description">{entry.description}</p>
                    <p className="muted history-row-actor">{entry.actorName}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
