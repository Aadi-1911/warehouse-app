import { Fragment, useEffect, useState } from 'react';
import { listFactories, updateFactory } from '../../api/factories';

// Owner Dashboard — Factories (added 2026-09-02). New nav page, not a port of an existing
// screen: unlike Party, Factory had NO list/management surface anywhere in the app before this —
// mobile only ever offers Factory as a plain <select>/create-on-the-fly picker embedded inside
// other screens (ReceiveStock, Article Pricing, Factory Payables), with no per-row detail or
// action of its own. PATCH /api/factories/:id (factoryController.js's updateFactory) has existed
// since before this page — this is simply its first caller from any frontend screen, not new
// backend behaviour.
//
// No PIN, matching updateFactory's own gating exactly: editing name/contact/GST is
// administrative, not the pricing-adjacent action rule 71's PIN gate exists to protect. OWNER
// enforcement is not something this page adds or could bypass — it's already double-covered
// independently of anything here: the /dashboard route tree's own requireRole gate (App.jsx)
// keeps a STAFF session off this screen entirely, and routes/factories.js's requireRole('OWNER')
// on the PATCH route runs server-side unconditionally regardless of what any client sends.
//
// A flat table, not a Factory-grouped accordion like Article Pricing/Low Stock/Live Stock/
// Transfer: those screens group ARTICLES by their Factory because Factory is the higher-level
// concept there. Here Factory itself IS the row — there's nothing above it to group by, so a
// single flat table (Article Pricing's own row shape, minus the grouping layer) is the correct
// fit, not an accordion of one section.
//
// Row-based inline edit, single editingId (not a Set) — same "only one row mid-edit at once"
// discipline Article Pricing's own price/rename edits already enforce, for the same reason: two
// simultaneously-open edit forms on the same table invite exactly the kind of "which one did I
// mean to save" confusion that discipline exists to prevent.
//
// Every scalar Factory field except id/isActive/createdAt is editable here: name, contact, gstNo.
// isActive has its own deactivate/reactivate endpoints (a different action, a different blast
// radius — same split updateFactory/deactivateFactory already draw in the backend) and isn't
// exposed on this page; archived factories still display (with a badge) since hiding them here
// would make a typo in an archived factory's name permanently uncorrectable from the UI.

const TABLE_COLUMN_COUNT = 4;

export default function DashboardFactories() {
  const [factories, setFactories] = useState([]);
  // 'idle' | 'loading' | 'loaded' — never a bare boolean, same discipline as every other
  // mount-fetching screen in this app.
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [gstNo, setGstNo] = useState('');
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  function load() {
    setStatus('loading');
    setLoadError(null);
    return listFactories()
      .then((list) => setFactories(list))
      .catch((err) => setLoadError(err.message))
      .finally(() => setStatus('loaded'));
  }

  useEffect(() => {
    load();
  }, []);

  function handleStartEdit(factory) {
    setEditingId(factory.id);
    // Pre-filled with the row's current values, not blank — a rename/contact-fix is almost
    // always a small correction to what's already there, same reasoning Article Pricing's own
    // handleStartRename gives.
    setName(factory.name);
    setContact(factory.contact ?? '');
    setGstNo(factory.gstNo ?? '');
    setFormError(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setName('');
    setContact('');
    setGstNo('');
    setFormError(null);
  }

  async function handleSaveEdit(factory) {
    setFormError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Enter a name.');
      return;
    }
    setSubmitting(true);
    try {
      await updateFactory(factory.id, {
        name: trimmedName,
        contact: contact.trim() || null,
        gstNo: gstNo.trim() || null,
      });
      setSuccessMessage(`${trimmedName} updated.`);
      handleCancelEdit();
      // Re-fetch so the table reflects the edit just made, never patched optimistically — same
      // discipline every other mutation in this app follows.
      await load();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleEnterKey(event, factory) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSaveEdit(factory);
    }
  }

  const sortedFactories = [...factories].sort((a, b) => a.name.localeCompare(b.name));

  if (status !== 'loaded') {
    return (
      <>
        {loadError && (
          <p className="error-banner" role="alert">
            Could not load factories: {loadError}
          </p>
        )}
        {!loadError && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {loadError && (
        <p className="error-banner" role="alert">
          Could not refresh factories: {loadError}
        </p>
      )}

      {successMessage && (
        <div className="result-banner result-banner-success">
          <p>{successMessage}</p>
          <button type="button" className="link-button" onClick={() => setSuccessMessage(null)}>
            OK
          </button>
        </div>
      )}

      {sortedFactories.length === 0 ? (
        <p className="muted dash-empty">No factories yet.</p>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="dash-factories-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>GSTIN</th>
                  <th className="dash-factories-action">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedFactories.map((factory, rowIndex) => {
                  const isEditing = editingId === factory.id;
                  const anyOtherRowBusy = editingId !== null && editingId !== factory.id;

                  return (
                    <Fragment key={factory.id}>
                      {/* Striped by DATA POSITION (rowIndex), not :nth-child — same reasoning
                          Article Pricing's own table gives: the conditionally-inserted error row
                          below would otherwise shift which stripe colour every later row lands on
                          each time it opens or closes. */}
                      <tr
                        className={[
                          isEditing ? 'dash-factories-row-editing' : '',
                          rowIndex % 2 === 1 ? 'dash-factories-row-alt' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              className="dash-factories-name-input"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              onKeyDown={(e) => handleEnterKey(e, factory)}
                              autoFocus
                              disabled={submitting}
                            />
                          ) : (
                            <>
                              {factory.name}
                              {!factory.isActive && (
                                <span className="badge badge-danger accordion-low-badge">Archived</span>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              className="dash-factories-inline-input"
                              value={contact}
                              onChange={(e) => setContact(e.target.value)}
                              onKeyDown={(e) => handleEnterKey(e, factory)}
                              disabled={submitting}
                            />
                          ) : (
                            factory.contact || <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              className="dash-factories-inline-input"
                              value={gstNo}
                              onChange={(e) => setGstNo(e.target.value)}
                              onKeyDown={(e) => handleEnterKey(e, factory)}
                              disabled={submitting}
                            />
                          ) : (
                            factory.gstNo || <span className="muted">—</span>
                          )}
                        </td>
                        <td className="dash-factories-action">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => handleSaveEdit(factory)}
                                disabled={submitting}
                              >
                                {submitting ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={handleCancelEdit}
                                disabled={submitting}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => handleStartEdit(factory)}
                              disabled={anyOtherRowBusy}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && formError && (
                        <tr className="dash-factories-error-row">
                          <td colSpan={TABLE_COLUMN_COUNT}>
                            <p className="error-banner" role="alert">
                              {formError}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
