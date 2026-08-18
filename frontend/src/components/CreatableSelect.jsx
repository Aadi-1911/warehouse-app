import { useState } from 'react';

// Extracted verbatim from ReceiveStock.jsx (2026-08-18) when Good Returns needed the same
// Location picker. Behaviour is unchanged — it was already a self-contained presentational
// component with no ties to Receive Stock's own state, it just happened to live in that file
// because Receive Stock was the only screen that had ever needed it.

// A sentinel option value, distinct from any real id (cuids never contain a space), so picking
// it can be told apart from picking a real Factory/Location/Color.
const CREATE_NEW_VALUE = '__create_new__';

// A <select> that can also grow its own list inline — 01_PRD.md §5.2/§5.4/§5.6 all describe
// Factory/Color/Location as lists that grow "as needed" from right inside the app, not from a
// separate admin screen. Picking "+ Create new…" swaps the select for a name field; submitting
// it calls onCreate(name), and the caller is responsible for adding the result to its own list
// and selecting it — this component only owns the toggle between "picking" and "typing a name".
//
// `canCreate` is a prop rather than something this component decides, because the answer differs
// per list AND per role: Location creation is OWNER-only on the backend, Factory/Color are open
// to any role. A screen that only ever picks from existing entries passes false.
export default function CreatableSelect({
  fieldLabel,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  canCreate,
  onCreate,
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(newName.trim());
      setNewName('');
      setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setAdding(false);
    setNewName('');
    setError(null);
  }

  if (adding) {
    return (
      <div className="field">
        <span className="field-label">{fieldLabel}</span>
        <div className="article-lookup-row">
          <input
            type="text"
            className="inline-create-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`New ${fieldLabel.toLowerCase()} name`}
            disabled={busy}
            autoFocus
          />
          <button
            type="button"
            className="btn-primary btn-inline"
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        <button type="button" className="link-button" onClick={handleCancel} disabled={busy}>
          Cancel
        </button>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <label className="field">
      <span className="field-label">{fieldLabel}</span>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === CREATE_NEW_VALUE) {
            setAdding(true);
            return;
          }
          onChange(e.target.value);
        }}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {canCreate && <option value={CREATE_NEW_VALUE}>+ Create new {fieldLabel.toLowerCase()}…</option>}
      </select>
    </label>
  );
}
