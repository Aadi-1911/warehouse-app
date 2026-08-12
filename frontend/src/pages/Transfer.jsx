import { useEffect, useState } from 'react';
import { TransferIcon } from '../components/icons';
import ConfirmModal from '../components/ConfirmModal';
import { listLocations } from '../api/locations';
import { listStock } from '../api/stock';
import { createTransfer } from '../api/transfers';

// Transfer — internal stock movement between our own Locations (05_BUSINESS_RULES.md rule 93).
// Not in 07_UI_DESIGN_BRIEF.md: transfers were an accepted Phase 1 limitation (rule 46) when
// that brief was written, so this screen follows the app's established conventions rather than
// a spec'd layout.
//
// WHY THIS SCREEN'S SELECTION IS SHAPED DIFFERENTLY FROM RECEIVE STOCK
// --------------------------------------------------------------------
// Receive Stock is creation-capable and factory-scoped: look up an article (create it if it
// doesn't exist), then pick a colour (create it if it doesn't exist). Two dependent dropdowns,
// each able to bring something into existence.
//
// A Transfer can only ever move something that ALREADY EXISTS, at a specific place. That
// changes what the unit of selection is. Whether a given article+colour is transferable
// depends on four things at once — Product, Colour, source Location, and qtySets > 0 — so an
// article-then-colour cascade would happily walk someone into a dead end (article exists,
// colour exists, but this location holds none of it). Instead the selectable unit here IS a
// Stock row: one flat list of concrete in-stock rows, filtered to the chosen source location,
// where every visible option is transferable by construction. One decision instead of two, and
// no dead ends to recover from.
//
// Consequently there is deliberately NO "+ Create new article/colour/location" anywhere on
// this screen. That absence is the clearest expression of what a Transfer is, and is not an
// oversight to be "fixed" later by pattern-matching Receive Stock's CreatableSelect.
export default function Transfer() {
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState(null);

  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');

  // Stock held at the currently selected source location. 'idle' | 'loading' | 'loaded', not a
  // boolean — the same three-state fix made for the colour picker: a fetch is kicked off by an
  // effect, which runs AFTER the render that first shows this UI, so a boolean would make
  // "haven't asked yet" indistinguishable from "asked, found nothing" and this screen would
  // claim "no stock at this location" for a few milliseconds on every single selection.
  const [sourceStock, setSourceStock] = useState([]);
  const [sourceStockStatus, setSourceStockStatus] = useState('idle');
  const [sourceStockError, setSourceStockError] = useState(null);

  const [search, setSearch] = useState('');
  // The chosen Stock row, kept whole rather than as a bare bundleId — its qtySets is what caps
  // the stepper, and its article/colour names are what the confirm modal reads back.
  const [selectedRow, setSelectedRow] = useState(null);
  const [qtySets, setQtySets] = useState(0);
  const [note, setNote] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [outcome, setOutcome] = useState(null); // { articleNo, colorName, qtySets, from, to }

  useEffect(() => {
    let cancelled = false;
    listLocations()
      .then((list) => {
        if (!cancelled) setLocations(list);
      })
      .catch((err) => {
        if (!cancelled) setLocationsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches whenever the source location changes. Scoping the query server-side
  // (?locationId=) rather than fetching everything and filtering here keeps the payload
  // proportional to one location's holdings, and means the rows this screen renders are
  // exactly the rows it's allowed to act on.
  useEffect(() => {
    if (!fromLocationId) {
      setSourceStockStatus('idle');
      setSourceStock([]);
      return;
    }

    let cancelled = false;
    setSourceStockStatus('loading');
    setSourceStockError(null);

    listStock({ locationId: fromLocationId })
      .then((rows) => {
        if (cancelled) return;
        // qtySets === 0 rows are real (a bundle/location pairing that was stocked then fully
        // drained keeps its Stock row) but they are not transferable, so they're filtered out
        // rather than shown as un-pickable noise.
        setSourceStock(rows.filter((r) => r.qtySets > 0));
      })
      .catch((err) => {
        if (!cancelled) setSourceStockError(err.message);
      })
      .finally(() => {
        if (!cancelled) setSourceStockStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [fromLocationId]);

  function handleFromLocationChange(newId) {
    setFromLocationId(newId);
    // Any selection made against the previous location is meaningless now — that Stock row
    // belongs to a location no longer being transferred from.
    setSelectedRow(null);
    setQtySets(0);
    setSearch('');
    setSubmitError(null);
    // Clearing a to-location that now equals the new from-location is what keeps the two
    // dropdowns from ever agreeing (the backend rejects it, but the UI shouldn't offer it).
    if (newId === toLocationId) setToLocationId('');
  }

  function handleSelectRow(row) {
    setSelectedRow(row);
    setQtySets(0);
    setSubmitError(null);
  }

  async function handleConfirmedSubmit() {
    setConfirmOpen(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createTransfer({
        bundleId: selectedRow.bundleId,
        fromLocationId,
        toLocationId,
        qtySets,
        note: note.trim() || undefined,
      });
      setOutcome({
        articleNo: result.transfer.productArticleNo,
        productName: result.transfer.productName,
        colorName: result.transfer.colorName,
        qtySets: result.transfer.qtySets,
        fromLocationName: result.transfer.fromLocationName,
        toLocationName: result.transfer.toLocationName,
        remainingAtSource: result.fromStock.qtySets,
      });
      // Reset the movement itself but deliberately KEEP fromLocationId/toLocationId — moving
      // several articles between the same two locations in a row is the common case, and
      // re-picking both every time would be busywork.
      setSelectedRow(null);
      setQtySets(0);
      setNote('');
      setSearch('');
      // Re-fetch so the list reflects the stock that just moved, rather than showing a
      // quantity that is now stale by exactly the amount just transferred.
      setSourceStockStatus('loading');
      const rows = await listStock({ locationId: fromLocationId });
      setSourceStock(rows.filter((r) => r.qtySets > 0));
      setSourceStockStatus('loaded');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const searchText = search.trim().toLowerCase();
  const visibleRows = searchText
    ? sourceStock.filter(
        (r) =>
          r.productArticleNo.toLowerCase().includes(searchText) ||
          r.colorName.toLowerCase().includes(searchText)
      )
    : sourceStock;

  // The source location is removed from the destination list entirely — the backend rejects a
  // same-location transfer with SAME_LOCATION, but an option that can only ever produce an
  // error shouldn't be offered in the first place.
  const destinationOptions = locations.filter((l) => l.id !== fromLocationId);

  const maxQty = selectedRow?.qtySets ?? 0;
  const canSubmit = !!selectedRow && !!toLocationId && qtySets > 0 && qtySets <= maxQty && !submitting;

  function stockListMessage() {
    if (!fromLocationId) return 'Select a source location to see what it holds.';
    if (sourceStockStatus !== 'loaded') return 'Loading…';
    if (sourceStock.length === 0) return 'This location holds no stock to transfer.';
    if (visibleRows.length === 0) return 'No stock here matches your search.';
    return null;
  }

  return (
    <div className="page">
      <header className="screen-header">
        <div className="icon-mark accent">
          <TransferIcon size={20} />
        </div>
        <div>
          <div className="eyebrow">Warehouse</div>
          <h1 className="screen-title">Transfer Stock</h1>
        </div>
      </header>

      {locationsError && (
        <p className="error-banner" role="alert">
          Could not load locations: {locationsError}
        </p>
      )}

      {outcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>Transfer saved.</strong> {outcome.qtySets} set
            {outcome.qtySets === 1 ? '' : 's'} of {outcome.articleNo} ({outcome.colorName}) moved
            from {outcome.fromLocationName} to {outcome.toLocationName}.
          </p>
          <p className="muted">
            {outcome.remainingAtSource} set{outcome.remainingAtSource === 1 ? '' : 's'} still at{' '}
            {outcome.fromLocationName}.
          </p>
          <button type="button" className="link-button" onClick={() => setOutcome(null)}>
            OK
          </button>
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span className="field-label">From</span>
          <select
            value={fromLocationId}
            onChange={(e) => handleFromLocationChange(e.target.value)}
            disabled={locationsLoading}
          >
            <option value="">{locationsLoading ? 'Loading…' : 'Select source'}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">To</span>
          <select
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            disabled={locationsLoading || !fromLocationId}
          >
            <option value="">
              {!fromLocationId ? 'Pick a source first' : 'Select destination'}
            </option>
            {destinationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h2 className="card-title">What are you moving?</h2>

        {/* No "+ Create new" affordance anywhere here, by design — see the note at the top of
            this file. A Transfer only ever moves stock that already exists. */}
        <label className="field">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search article or colour"
            disabled={!fromLocationId || sourceStockStatus !== 'loaded'}
          />
        </label>

        {sourceStockError && (
          <p className="error-banner" role="alert">
            Could not load stock: {sourceStockError}
          </p>
        )}

        {stockListMessage() ? (
          <p className="muted centered-empty-state">{stockListMessage()}</p>
        ) : (
          <div className="transfer-stock-list">
            {visibleRows.map((row) => {
              const selected = selectedRow?.bundleId === row.bundleId;
              return (
                <button
                  key={row.bundleId}
                  type="button"
                  className={`transfer-stock-row ${selected ? 'transfer-stock-row-selected' : ''}`}
                  onClick={() => handleSelectRow(row)}
                  aria-pressed={selected}
                >
                  <span className="transfer-row-article">{row.productArticleNo}</span>
                  <span className="transfer-row-color">{row.colorName}</span>
                  <span className="transfer-row-qty">
                    {row.qtySets} set{row.qtySets === 1 ? '' : 's'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedRow && (
          <div className="field">
            <span className="field-label">
              Sets to move — {selectedRow.qtySets} available at{' '}
              {locations.find((l) => l.id === fromLocationId)?.name}
            </span>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setQtySets((n) => Math.max(0, n - 1))}
                disabled={qtySets === 0}
                aria-label="Decrease sets"
              >
                −
              </button>
              <span className="stepper-value">{qtySets}</span>
              {/* Capped at what the source actually holds. The backend's guarded UPDATE is the
                  real enforcement (it's what makes two simultaneous transfers safe) — this cap
                  just means the happy path never walks into that error on purpose. */}
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setQtySets((n) => Math.min(maxQty, n + 1))}
                disabled={qtySets >= maxQty}
                aria-label="Increase sets"
              >
                +
              </button>
            </div>

            <label className="field">
              <span className="field-label">Note (optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. sent with the Tuesday van"
              />
            </label>
          </div>
        )}

        {submitError && (
          <p className="error-banner" role="alert">
            Could not save transfer: {submitError}
          </p>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={() => setConfirmOpen(true)}
          disabled={!canSubmit}
        >
          {submitting ? 'Saving…' : 'Transfer stock'}
        </button>
      </div>

      {/* One confirmation, not Receive Stock's two-step. This moves stock between our own
          locations without changing the company-wide total — a mistake here is corrected by
          transferring back, unlike a receipt, which invents inventory that didn't exist. */}
      <ConfirmModal
        open={confirmOpen}
        title="Confirm this transfer"
        body={
          selectedRow
            ? `Move ${qtySets} set${qtySets === 1 ? '' : 's'} of ${selectedRow.productArticleNo} (${selectedRow.colorName}) from ${locations.find((l) => l.id === fromLocationId)?.name} to ${locations.find((l) => l.id === toLocationId)?.name}. Live stock updates immediately at both locations.`
            : ''
        }
        confirmLabel="Transfer stock"
        tone="accent"
        onConfirm={handleConfirmedSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
