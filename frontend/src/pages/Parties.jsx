import { useEffect, useState } from 'react';
import { PartyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { listParties, createParty, deactivateParty, reactivateParty } from '../api/parties';

// Party List — Create + Archive/Reactivate on top of the prior task's read-only list.
// Owner-only at the route level (App.jsx) — POST/deactivate/reactivate are owner-only
// server-side too, so this is defense in depth, not a new restriction.
//
// `status` is the explicit 'idle' | 'loading' | 'loaded' shape CLAUDE.md requires for anything
// fetched on mount — unchanged from the prior task.
export default function Parties() {
  const [parties, setParties] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Show archived — reuses Category's exact mechanism (ReceiveStock.jsx), not Manage Users':
  // Manage Users always shows every account with a status badge, but this screen's default
  // (archived hidden) predates this task and must stay unchanged, so archived parties only
  // join the list when this is on — unioned in, not swapped to an archived-only view.
  const [showArchived, setShowArchived] = useState(false);

  // Create — a plain form, no modal, matching Manage Users' own Create account card.
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [gstNo, setGstNo] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  // Archive/Reactivate — same confirmTarget/ConfirmModal shape as Manage Users and Article
  // Pricing: null | { party, action: 'archive' | 'reactivate' }. No PIN — not a price action.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState(null);

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

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createParty({ name, shopName, location, address, contact, gstNo });
      // Appended to the same `parties` state the list below derives from — the new party
      // appears correctly sorted/filtered without a re-fetch, same pattern as Manage Users'
      // handleCreate and ReceiveStock's handleCreateCategory.
      setParties((prev) => [...prev, created]);
      setCreateSuccess(`${created.name} added.`);
      setName('');
      setShopName('');
      setLocation('');
      setAddress('');
      setContact('');
      setGstNo('');
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleStartArchiveAction(party, action) {
    setConfirmTarget({ party, action });
    setActionError(null);
  }

  async function handleConfirmArchiveAction() {
    if (!confirmTarget) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      const { party, action } = confirmTarget;
      const call = action === 'archive' ? deactivateParty : reactivateParty;
      const updated = await call(party.id);
      setParties((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setConfirmTarget(null);
    } catch (err) {
      setActionError(err.message);
      setConfirmTarget(null);
    } finally {
      setActionInFlight(false);
    }
  }

  // Active parties only by default; archived ones join when the toggle is on (Category's
  // pattern — see the showArchived comment above).
  const visibleParties = parties.filter((p) => showArchived || p.isActive);

  const searchText = search.trim().toLowerCase();
  const filteredParties = searchText
    ? visibleParties.filter(
        (p) =>
          p.name.toLowerCase().includes(searchText) ||
          (p.shopName ?? '').toLowerCase().includes(searchText)
      )
    : visibleParties;

  const sortedParties = [...filteredParties].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <ScreenHeader icon={<PartyIcon size={20} />} title="Manage Parties" />

      <div className="card">
        <h2 className="card-title">Create party</h2>

        <form onSubmit={handleCreate}>
          <label className="field">
            <span className="field-label">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <label className="field">
            <span className="field-label">Shop name</span>
            <input type="text" value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">Location</span>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">Address</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">Contact</span>
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">GSTIN</span>
            <input type="text" value={gstNo} onChange={(e) => setGstNo(e.target.value)} />
          </label>

          {createError && (
            <p className="error-banner" role="alert">
              {createError}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create party'}
          </button>
        </form>
      </div>

      {createSuccess && (
        <div className="result-banner result-banner-success">
          <p>{createSuccess}</p>
          <button type="button" className="link-button" onClick={() => setCreateSuccess(null)}>
            OK
          </button>
        </div>
      )}

      {error && (
        <p className="error-banner" role="alert">
          Could not load parties: {error}
        </p>
      )}

      {actionError && (
        <p className="error-banner" role="alert">
          {actionError}
        </p>
      )}

      {status === 'loaded' && !error && (
        <>
          <label className="field">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or shop name"
            />
          </label>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </>
      )}

      {status !== 'loaded' && <p className="muted centered-empty-state">Loading…</p>}

      {status === 'loaded' && !error && (
        visibleParties.length === 0 ? (
          // Zero parties in the currently relevant scope — genuinely zero records if the
          // toggle is off, zero ARCHIVED records specifically if it's on. Either way this is a
          // real state, not a search coming up empty, so it needs its own distinct copy.
          <p className="muted centered-empty-state">
            {showArchived ? 'No archived parties.' : 'No parties yet.'}
          </p>
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
                {!p.isActive && <span className="badge badge-danger">Archived</span>}
                {p.isActive ? (
                  <button
                    type="button"
                    className="link-button danger-text"
                    onClick={() => handleStartArchiveAction(p, 'archive')}
                    disabled={actionInFlight}
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => handleStartArchiveAction(p, 'reactivate')}
                    disabled={actionInFlight}
                  >
                    Reactivate
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.action === 'archive' ? 'Archive this party?' : 'Reactivate this party?'}
        body={
          confirmTarget?.action === 'archive'
            ? `${confirmTarget?.party.name} will be hidden from the default list. It can be reactivated anytime.`
            : `${confirmTarget?.party.name} will be visible again in the default list immediately.`
        }
        confirmLabel={
          actionInFlight ? 'Working…' : confirmTarget?.action === 'archive' ? 'Archive' : 'Reactivate'
        }
        tone={confirmTarget?.action === 'archive' ? 'danger' : 'success'}
        onConfirm={handleConfirmArchiveAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
