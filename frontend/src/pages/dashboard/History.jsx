import { useEffect, useState } from 'react';
import { listHistory } from '../../api/history';

// Owner Dashboard — History (07_UI_DESIGN_BRIEF.md §8's "History page" section, rules 58 and 70).
//
// Same feed, same day-grouping, same per-type tag colours as the staff-facing History.jsx —
// deliberately not re-derived here. This page borrows that screen's grouping logic and CSS
// classes (.history-day / .history-row / etc, already generic — no mobile-only assumptions) so
// the two surfaces can't quietly drift apart on what a day boundary or a tag colour means. GET
// /api/history is unfiltered and already returns every entry with no pagination (04_API_SPEC.md),
// so this page adds no query params — it renders the full feed, whereas Overview's own activity
// widget deliberately only shows a recent slice.
//
// Read-only, per rule 70 — "Owner's view of History is read-only — no correction affordance on
// the owner surface, even though staff's History screen has one." Checked staff's History.jsx
// before writing this: as it exists today, that screen has NO edit/correction UI at all (rule
// 65's fixed-reason-category picker isn't wired up anywhere in the frontend yet) — so there was
// nothing to accidentally carry over by reusing its grouping logic. This page still renders
// nothing but the tag/description/actor/party/time for each row, on purpose, so it stays correct
// even after a correction affordance eventually gets built on the staff side.

const TYPE_BADGE_CLASSES = {
  ORDER_PLACED: 'badge-purple',
  ORDER_STATUS: 'badge-success',
  ORDER_ADJUSTMENT: 'badge-warning',
  TRANSFER: 'badge-accent',
  GOOD_RETURN: 'badge-warning',
};

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

export default function History() {
  const [entries, setEntries] = useState([]);
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

  // Same "insert a heading only when the calendar day changes" grouping as staff's screen —
  // the server already sorts newest-first, this never re-sorts.
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

  if (status !== 'loaded') {
    return (
      <>
        {error && (
          <p className="error-banner" role="alert">
            Could not load history: {error}
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
          Could not refresh history: {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="muted dash-empty">Nothing recorded yet.</p>
      ) : (
        days.map((day) => (
          <div key={day.heading} className="history-day">
            <div className="eyebrow history-day-heading">{day.heading}</div>
            <div className="dash-card history-day-card">
              {day.entries.map((entry) => {
                const badgeClass = TYPE_BADGE_CLASSES[entry.type] ?? FALLBACK_BADGE_CLASS;
                return (
                  <div key={entry.id} className="history-row">
                    <div className="history-row-top">
                      <span className={`badge ${badgeClass}`}>{entry.label ?? FALLBACK_LABEL}</span>
                      <span className="muted history-row-time">{formatTime(entry.timestamp)}</span>
                    </div>
                    <p className="history-row-description">{entry.description}</p>
                    <p className="muted history-row-actor">
                      {entry.actorName}
                      {entry.partyName ? ` · ${entry.partyName}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
