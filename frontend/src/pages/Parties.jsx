import { useEffect, useState } from 'react';
import { PartyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listParties } from '../api/parties';

// Party List — read-only slice only (04_API_SPEC.md's GET /api/parties is any authenticated
// role, so this screen is reachable by both OWNER and STAFF — see Home.jsx's MORE_ITEMS entry).
// Create/edit/archive are a separate follow-up task; this screen has no write calls at all.
//
// `status` is the explicit 'idle' | 'loading' | 'loaded' shape CLAUDE.md requires for anything
// fetched on mount — same pattern already used in ArticlePricing.jsx. A bare `loading` boolean
// starting `false` would be indistinguishable from "fetch finished, found nothing," which
// matters a lot here specifically: the real dev database currently has zero Party rows, so a
// collapsed boolean would show the empty state for a moment before the fetch even started,
// every single time this screen loads.
export default function Parties() {
  const [parties, setParties] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    listParties()
      .then((list) => {
        if (!cancelled) setParties(list);
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

  // GET /api/parties returns archived rows too (backend-returns-everything convention, same as
  // Category/Product) — this screen's job is the daily-use active list, so archived parties are
  // filtered out here rather than server-side. Reactivating one is out of scope for this task.
  const activeParties = parties.filter((p) => p.isActive);

  const searchText = search.trim().toLowerCase();
  const filteredParties = searchText
    ? activeParties.filter(
        (p) =>
          p.name.toLowerCase().includes(searchText) ||
          (p.shopName ?? '').toLowerCase().includes(searchText)
      )
    : activeParties;

  const sortedParties = [...filteredParties].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <ScreenHeader icon={<PartyIcon size={20} />} title="Manage Parties" />

      {error && (
        <p className="error-banner" role="alert">
          Could not load parties: {error}
        </p>
      )}

      {status === 'loaded' && !error && (
        <label className="field">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or shop name"
          />
        </label>
      )}

      {status !== 'loaded' && <p className="muted centered-empty-state">Loading…</p>}

      {status === 'loaded' && !error && (
        activeParties.length === 0 ? (
          // Zero real parties, not a search coming up empty — this is the state a fresh
          // install actually lands in today (confirmed: the real dev database currently has no
          // Party rows), so it needs to read as "nothing here yet," not as a failure.
          <p className="muted centered-empty-state">No parties yet.</p>
        ) : sortedParties.length === 0 ? (
          <p className="muted centered-empty-state">No results match your search.</p>
        ) : (
          <div className="card">
            {sortedParties.map((p) => (
              <div key={p.id} className="party-row">
                <div className="party-row-name">
                  <span className="party-row-primary">{p.name}</span>
                  {p.shopName && <span className="muted party-row-shopname">{p.shopName}</span>}
                </div>
                {p.location && <span className="muted">{p.location}</span>}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
