import { useEffect, useRef, useState } from 'react';
import { TransferIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { listLocations } from '../api/locations';
import { listStock } from '../api/stock';
import { createTransfer } from '../api/transfers';

// Transfer — internal stock movement between our own Locations (05_BUSINESS_RULES.md rule 93).
// Not in 07_UI_DESIGN_BRIEF.md's original §5 screen list: transfers were an accepted Phase 1
// limitation (rule 46) when that brief was written, so the base screen (single Stock row, one
// immediate submit) followed the app's established conventions rather than a spec'd layout.
// Staged multi-line batching, added later, IS a new, deliberate design decision — not the
// restoration of some previously-spec'd-but-unbuilt feature — see LEARNING_LOG.md's entry on
// this for the honest provenance and why it doesn't conflict with the reasoning below.
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
// no dead ends to recover from. Staging multiple lines doesn't change any of this — each staged
// line is still just one whole Stock row + a quantity, picked the same way.
//
// Consequently there is deliberately NO "+ Create new article/colour/location" anywhere on
// this screen. That absence is the clearest expression of what a Transfer is, and is not an
// oversight to be "fixed" later by pattern-matching Receive Stock's CreatableSelect.
//
// FACTORY → ARTICLE GROUPING (07_UI_DESIGN_BRIEF.md §5.9 amendment) — NOT a reversal of the above
// -----------------------------------------------------------------------------------------------
// The reasoning above is about SELECTION: a flat list of concrete Stock rows means every visible
// option is real and transferable, with no cascade that can dead-end. That guarantee is about
// what data is allowed to appear, not about how it's laid out on screen — grouping the exact same
// rows by Factory, then by Article (collapsible, matching Live Stock's accordion), changes only
// the second thing. Nothing here is looked up or matched into existence: the Factory dropdown's
// own options are derived from the Factories actually present in the already-fetched, already-
// transferable row set (see factoryOptions below), not from a separate factory list that could
// offer a Factory with zero stock at this Location. A colour row nested three levels deep is
// still exactly one Stock row, selected the same way a flat row always was — see LEARNING_LOG.md.
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

  // Which Factory the browsing hierarchy is currently scoped to — '' means none chosen yet.
  // Only meaningful when search is empty; a search term bypasses Factory scoping entirely (see
  // searchResults below) since a search is already a narrower, more direct way to find one row.
  const [factoryId, setFactoryId] = useState('');
  // Which Article-level accordion sections are open — a Set of productId, same shape as Live
  // Stock's own expandedArticles (LiveStock.jsx). Both start collapsed; there's no Factory-level
  // accordion here the way Live Stock has one, since Factory is a single-select dropdown instead
  // (07_UI_DESIGN_BRIEF.md §5.9 amendment) — only one Factory's articles are ever on screen.
  const [expandedArticles, setExpandedArticles] = useState(new Set());

  // The row currently being configured — kept whole rather than as a bare bundleId, same
  // reasoning as before. Not yet staged; "+ Add to transfer" (or picking a different row) is
  // what folds it into stagedLines.
  const [selectedRow, setSelectedRow] = useState(null);
  const [qtySets, setQtySets] = useState(0);
  const [note, setNote] = useState('');

  // Every queued line, across any number of different articles/colours — mirrors Receive
  // Stock's stagedColors, but flat rather than two-tiered: a Transfer line is already
  // self-contained (one Stock row + a quantity + a destination), so unlike Receive Stock there
  // is no "colours within one article" sub-grouping step needed before it can be queued.
  const [stagedLines, setStagedLines] = useState([]);
  // Local-only ids for staged lines (React keys + removal target) — never sent to the backend,
  // which only ever sees bundleId/locationId/qtySets per individual POST.
  const nextLineIdRef = useRef(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(null); // { done, total } while submitting
  // Outcome of the last "Transfer stock" attempt — { succeededCount, failedLines }. Modeled on
  // Receive Stock's saveOutcome for the exact same reason: a batch of independently-atomic
  // writes needs to report a partial result honestly, not collapse to a single pass/fail.
  const [outcome, setOutcome] = useState(null);

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
    // belongs to a location no longer being transferred from. Every staged line was built from
    // THIS location's rows too (every line snapshots its own fromLocationId, but in practice
    // they all currently match, since this is the only place that value ever changes) — so a
    // source switch wipes the whole staged batch rather than leaving lines that no longer
    // correspond to what's on screen.
    setSelectedRow(null);
    setQtySets(0);
    setNote('');
    setSearch('');
    setStagedLines([]);
    // The Factory dropdown's own options are derived from THIS location's rows (see
    // factoryOptions below) — a new location can offer an entirely different set of Factories,
    // so the previous selection (and whichever articles were left expanded under it) can't
    // carry over meaningfully.
    setFactoryId('');
    setExpandedArticles(new Set());
    // Clearing a to-location that now equals the new from-location is what keeps the two
    // dropdowns from ever agreeing (the backend rejects it, but the UI shouldn't offer it).
    if (newId === toLocationId) setToLocationId('');
  }

  // A new Factory means an entirely different set of Articles on screen — collapse everything
  // and drop any in-progress row selection, the same reasoning handleFromLocationChange uses
  // for a Location switch. stagedLines is deliberately left untouched: a staged line is tied to
  // the source Location it was picked from (fromLocationId), not to which Factory is currently
  // being BROWSED, so a line staged while looking at a different Factory stays perfectly valid
  // and stays staged — this task's own instruction that staging is unaffected by the new picker.
  function handleFactoryChange(newFactoryId) {
    setFactoryId(newFactoryId);
    setExpandedArticles(new Set());
    setSelectedRow(null);
    setQtySets(0);
    setNote('');
  }

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // Shared by row-switching and "Transfer stock": folds the currently active row (if it has a
  // valid quantity + destination) into the staged list. Returns the resulting array so a caller
  // that needs it immediately (handleOpenConfirm) isn't stuck waiting on the next render — same
  // shape as Receive Stock's finalizeActiveColor.
  function finalizeActiveLine(currentStaged) {
    if (!selectedRow || qtySets <= 0 || !toLocationId) return currentStaged;
    return [
      ...currentStaged,
      {
        id: nextLineIdRef.current++,
        bundleId: selectedRow.bundleId,
        articleNo: selectedRow.productArticleNo,
        colorName: selectedRow.colorName,
        qtySets,
        fromLocationId,
        fromLocationName: locations.find((l) => l.id === fromLocationId)?.name ?? '',
        toLocationId,
        toLocationName: locations.find((l) => l.id === toLocationId)?.name ?? '',
        note: note.trim() || undefined,
      },
    ];
  }

  // Picking a different row silently finalizes whatever was active before it — matching Receive
  // Stock's colour-switch behaviour. The explicit "+ Add to transfer" button below exists for
  // the same reason Receive Stock's "+ Add another colour" does: per the standing discoverability
  // rule, a non-obvious interaction (switching rows quietly stages the old one) needs its own
  // visible, explicit affordance too, not just a side effect someone has to already know about.
  function handleSelectRow(row) {
    setStagedLines((prev) => finalizeActiveLine(prev));
    setSelectedRow(row);
    setQtySets(0);
    setNote('');
  }

  function handleStageAnother() {
    setStagedLines((prev) => finalizeActiveLine(prev));
    setSelectedRow(null);
    setQtySets(0);
    setNote('');
  }

  function handleRemoveStaged(lineId) {
    setStagedLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  // "Real available qtySets" (requirement 6) has to account for quantity this same row already
  // has staged-but-not-yet-submitted, not just the raw figure from the last fetch — otherwise
  // the same row could be staged twice for more than it actually holds (e.g. staged 5 of 5
  // available, then staged another 5 from the same still-showing-5 row) and the cap would be
  // fictional. Every staged line's fromLocationId always matches the current one (a source
  // switch wipes stagedLines above), so summing by bundleId alone is safe here.
  function remainingForRow(row) {
    const staged = stagedLines
      .filter((l) => l.bundleId === row.bundleId)
      .reduce((sum, l) => sum + l.qtySets, 0);
    return row.qtySets - staged;
  }

  async function handleOpenConfirm() {
    const finalLines = finalizeActiveLine(stagedLines);
    if (finalLines.length === 0) return;
    setStagedLines(finalLines);
    setSelectedRow(null);
    setQtySets(0);
    setNote('');
    setSearch('');
    setConfirmOpen(true);
  }

  // Submits every staged line sequentially — deliberately not Promise.all/batched, and never
  // stops early on a failure. Each POST is independently atomic on the backend (paired
  // TRANSFER_OUT/TRANSFER_IN legs in one DB transaction); a line that succeeds is a real stock
  // change and must never be undone just because a later line fails. Running every line
  // regardless of earlier failures means the result is always a complete, unambiguous picture,
  // and failed lines are kept staged afterward so retrying needs no re-entry — mirrors Receive
  // Stock's handleSaveReceiptConfirmed exactly, for the same reasons.
  async function handleConfirmedSubmit() {
    setConfirmOpen(false);
    const lines = stagedLines;
    setSubmitting(true);
    setSubmitProgress({ done: 0, total: lines.length });

    const failedLines = [];
    let succeededCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        await createTransfer({
          bundleId: line.bundleId,
          fromLocationId: line.fromLocationId,
          toLocationId: line.toLocationId,
          qtySets: line.qtySets,
          note: line.note,
        });
        succeededCount++;
      } catch {
        failedLines.push(line);
      }
      setSubmitProgress({ done: i + 1, total: lines.length });
    }

    setSubmitting(false);
    setSubmitProgress(null);
    // Only the lines that failed stay staged — a succeeded line is already a committed stock
    // change and must not reappear as something still waiting to be sent. Written as a merge
    // against whatever's CURRENTLY in stagedLines, not a flat replace: staging is disabled
    // while submitting (see canStage/the row buttons below), but this is the backstop in case
    // that's ever bypassed — `lines` is a snapshot from the START of this submission, so
    // anything in current state that wasn't part of that snapshot was staged mid-submit and
    // must survive, not be silently clobbered by overwriting state with a stale plan.
    setStagedLines((prev) => {
      const submittedIds = new Set(lines.map((l) => l.id));
      const stagedMidSubmit = prev.filter((l) => !submittedIds.has(l.id));
      return [...failedLines, ...stagedMidSubmit];
    });
    setOutcome({ succeededCount, failedLines });

    // Re-fetch regardless of outcome: any succeeded line changed this location's real
    // quantities, and stale numbers here would misrepresent what's actually left to move.
    if (fromLocationId) {
      setSourceStockStatus('loading');
      const rows = await listStock({ locationId: fromLocationId });
      setSourceStock(rows.filter((r) => r.qtySets > 0));
      setSourceStockStatus('loaded');
    }
  }

  const searchText = search.trim().toLowerCase();

  // The base set behind everything below: real, currently-transferable rows at this Location —
  // same "remaining > 0, or currently being configured" filter the flat list has always applied
  // (requirement 6's staged-quantity cap), computed once so search results, Factory options, and
  // the Article groups are all derived from an identical, consistent set of rows.
  const availableRows = sourceStock.filter(
    (r) => remainingForRow(r) > 0 || r.bundleId === selectedRow?.bundleId
  );

  // A search term bypasses Factory/Article grouping entirely and searches across the WHOLE
  // location, unchanged from this screen's original behavior — narrowing by typing is already a
  // more direct way to find one specific row than picking a Factory first would be, so there's
  // no reason to make search Factory-scoped too.
  const searchResults = searchText
    ? availableRows.filter(
        (r) =>
          r.productArticleNo.toLowerCase().includes(searchText) ||
          r.colorName.toLowerCase().includes(searchText)
      )
    : [];

  // Factory options come from the Factories actually present in availableRows — never a
  // separate listFactories() call. That's what keeps "every visible choice is real" true one
  // level up: a fetched-independently Factory list could offer a Factory with zero transferable
  // stock at this Location, which would be its own small dead end, exactly what the flat-list
  // design at the top of this file exists to avoid for individual rows (LEARNING_LOG.md).
  const factoryOptions = Array.from(new Map(availableRows.map((r) => [r.factoryId, r.factoryName])).entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Grouped by Article for the accordion (07_UI_DESIGN_BRIEF.md §5.9 amendment) — only the rows
  // under the currently selected Factory. Array.from(Map.values()) preserves first-seen order;
  // sorted by articleNo afterward for a stable, predictable list rather than raw fetch order.
  const articleGroups = (() => {
    if (!factoryId) return [];
    const byProduct = new Map();
    for (const row of availableRows) {
      if (row.factoryId !== factoryId) continue;
      if (!byProduct.has(row.productId)) {
        byProduct.set(row.productId, { productId: row.productId, articleNo: row.productArticleNo, rows: [] });
      }
      byProduct.get(row.productId).rows.push(row);
    }
    return Array.from(byProduct.values()).sort((a, b) => a.articleNo.localeCompare(b.articleNo));
  })();

  // The source location is removed from the destination list entirely — the backend rejects a
  // same-location transfer with SAME_LOCATION, but an option that can only ever produce an
  // error shouldn't be offered in the first place.
  const destinationOptions = locations.filter((l) => l.id !== fromLocationId);

  const maxQty = selectedRow ? remainingForRow(selectedRow) : 0;
  // !submitting matters: without it, a line could be staged while a previous batch is still
  // mid-flight, landing in the same stagedLines array handleConfirmedSubmit is about to
  // overwrite at the end of its run — see the merge-not-replace comment there for the backstop
  // this is the primary defense against.
  const canStage = !!selectedRow && qtySets > 0 && qtySets <= maxQty && !!toLocationId && !submitting;
  // Permissive the same way Receive Stock's canAddToReceipt is: a row picked and quantified but
  // never explicitly staged must still count when opening the confirm step, not be silently
  // dropped just because "+ Add to transfer" was never clicked.
  const canOpenConfirm = (stagedLines.length > 0 || canStage) && !submitting;

  const stagedTotalSets = stagedLines.reduce((sum, l) => sum + l.qtySets, 0);
  const stagedDestinations = new Set(stagedLines.map((l) => l.toLocationName));

  function stockListMessage() {
    if (!fromLocationId) return 'Select a source location to see what it holds.';
    if (sourceStockStatus !== 'loaded') return 'Loading…';
    if (sourceStock.length === 0) return 'This location holds no stock to transfer.';
    if (searchText) return searchResults.length === 0 ? 'No stock here matches your search.' : null;
    if (!factoryId) return 'Select a factory to see its articles.';
    return null;
  }

  // Shared by the search-results list, a single-colour article (no pointless accordion for one
  // item — requirement), and colour rows nested inside an expanded Article. showArticle is false
  // only in that last case, where the Article No is already shown once in the accordion header
  // and repeating it on every colour row underneath would be redundant. Selection/staging
  // behavior is identical in all three places — this is still exactly the same row-picking
  // mechanism the flat list always used, just reached through a different path on screen.
  function renderStockRow(row, { showArticle }) {
    const selected = selectedRow?.bundleId === row.bundleId;
    return (
      <button
        key={row.bundleId}
        type="button"
        className={`transfer-stock-row ${selected ? 'transfer-stock-row-selected' : ''}`}
        onClick={() => handleSelectRow(row)}
        aria-pressed={selected}
        // Disabled while a batch is submitting — staging a new line here would land in the same
        // stagedLines array handleConfirmedSubmit is mid-flight on.
        disabled={submitting}
      >
        {showArticle && <span className="transfer-row-article">{row.productArticleNo}</span>}
        <span className="transfer-row-color">{row.colorName}</span>
        <span className="transfer-row-qty">
          {remainingForRow(row)} set{remainingForRow(row) === 1 ? '' : 's'}
        </span>
      </button>
    );
  }

  return (
    <div className="page">
      <ScreenHeader icon={<TransferIcon size={20} />} title="Transfer Stock" />

      {locationsError && (
        <p className="error-banner" role="alert">
          Could not load locations: {locationsError}
        </p>
      )}

      {/* Plain-language result of the last "Transfer stock" attempt — same reasoning as Receive
          Stock's saveOutcome banner: a batch of independently-atomic writes can partially fail,
          so this has to report exactly what happened, never a single collapsed pass/fail. */}
      {outcome && (
        <div
          className={`result-banner ${
            outcome.failedLines.length === 0 ? 'result-banner-success' : 'result-banner-warning'
          }`}
        >
          {outcome.failedLines.length === 0 ? (
            <p>
              <strong>Transfer saved.</strong> Live stock has been updated.
            </p>
          ) : outcome.succeededCount === 0 ? (
            <p>
              <strong>Nothing could be transferred right now.</strong> Nothing in your staged
              list was lost — please check your connection and try again.
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {outcome.succeededCount} of{' '}
                  {outcome.succeededCount + outcome.failedLines.length} lines transferred
                </strong>{' '}
                and already moved.
              </p>
              <p>These are still staged below — please try again:</p>
              <ul className="result-banner-list">
                {outcome.failedLines.map((l) => (
                  <li key={l.id}>
                    {l.articleNo} — {l.colorName} — {l.qtySets} sets → {l.toLocationName}
                  </li>
                ))}
              </ul>
            </>
          )}
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

        {/* Factory dropdown — appears once a Location is chosen and its stock has loaded
            (07_UI_DESIGN_BRIEF.md §5.9 amendment), matching Receive Stock's Factory-first
            pattern. Hidden while searching: a search term already scopes across the whole
            Location on its own, so a Factory filter sitting inert alongside it would be
            confusing rather than helpful. */}
        {!searchText && fromLocationId && sourceStockStatus === 'loaded' && sourceStock.length > 0 && (
          <label className="field">
            <span className="field-label">Factory</span>
            <select value={factoryId} onChange={(e) => handleFactoryChange(e.target.value)} disabled={submitting}>
              <option value="">Select factory</option>
              {factoryOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {stockListMessage() ? (
          <p className="muted centered-empty-state">{stockListMessage()}</p>
        ) : searchText ? (
          // Flat search-result list — unchanged behavior, works across every Factory at once.
          <div className="transfer-stock-list">
            {searchResults.map((row) => renderStockRow(row, { showArticle: true }))}
          </div>
        ) : (
          // Factory → Article (collapsible) → Colour hierarchy (07_UI_DESIGN_BRIEF.md §5.9
          // amendment), scoped to the chosen Factory. Reuses Live Stock's shared accordion
          // classes as-is (LiveStock.jsx/index.css) — this is a single level of accordion, not
          // Live Stock's two (Factory here is a dropdown, not its own accordion layer, since
          // only one Factory's articles are ever visible at a time).
          <div className="transfer-stock-list">
            {articleGroups.map((article) => {
              // An article with exactly one colour has nothing to disambiguate — collapsing it
              // behind a header + chevron would be a click for no reason, so it renders as a
              // plain row directly, same as Live Stock's single-Location collapse (§5.5).
              if (article.rows.length === 1) {
                return renderStockRow(article.rows[0], { showArticle: true });
              }

              const expanded = expandedArticles.has(article.productId);
              return (
                <div key={article.productId} className="accordion-section nested">
                  <button
                    type="button"
                    className="accordion-header nested"
                    onClick={() => toggleArticle(article.productId)}
                    aria-expanded={expanded}
                  >
                    <div className="accordion-header-text">
                      <div className="accordion-title-sm">{article.articleNo}</div>
                      <div className="accordion-subtitle">
                        <span className="badge badge-accent">
                          {article.rows.length} colour{article.rows.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                    <ChevronIcon className={expanded ? 'chevron chevron-open' : 'chevron'} />
                  </button>

                  {expanded && (
                    <div className="accordion-body nested">
                      {article.rows.map((row) => renderStockRow(row, { showArticle: false }))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selectedRow && (
          <div className="field">
            <span className="field-label">
              Sets to move — {maxQty} available at{' '}
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
              {/* Capped at what's actually still available for this row (requirement 6) —
                  raw stock minus whatever this same row already has staged. The backend's
                  guarded UPDATE is the real enforcement (it's what makes two simultaneous
                  transfers safe) — this cap just means the happy path never walks into that
                  error on purpose. */}
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

        {/* Explicit, always-visible "stage more" step — distinct from "Transfer stock" below,
            which commits the WHOLE staged batch. Disabled until there's an active row +
            quantity + destination actually worth staging, same guard finalizeActiveLine itself
            uses. Requires a destination up front since a staged line snapshots its own
            toLocationId rather than reading it live at submit time. */}
        <button
          type="button"
          className="btn-secondary"
          onClick={handleStageAnother}
          disabled={!canStage}
        >
          + Add to transfer
        </button>

        {/* Staged lines — every queued line across any number of articles, removable
            individually before "Transfer stock" commits the whole batch. Destination is shown
            per line (not assumed uniform) since it's possible, though not the common case, to
            change the "To" dropdown between staging different lines in the same batch. */}
        {stagedLines.length > 0 && (
          <div className="staged-list">
            {stagedLines.map((l) => (
              <div key={l.id} className="staged-row">
                <span className="staged-color-name">
                  {l.articleNo} — {l.colorName}
                </span>
                <span className="muted">
                  {l.qtySets} set{l.qtySets === 1 ? '' : 's'} → {l.toLocationName}
                </span>
                <button
                  type="button"
                  className="link-button danger-text"
                  onClick={() => handleRemoveStaged(l.id)}
                  aria-label={`Remove ${l.articleNo} — ${l.colorName}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={handleOpenConfirm}
          disabled={!canOpenConfirm}
        >
          {submitting
            ? `Transferring ${submitProgress.done} of ${submitProgress.total}…`
            : 'Transfer stock'}
        </button>
      </div>

      {/* One confirmation, not Receive Stock's two-step. This moves stock between our own
          locations without changing the company-wide total — a mistake here is corrected by
          transferring back, unlike a receipt, which invents inventory that didn't exist. That
          reasoning is unchanged by batching: it's still true per line, so the summary here
          stays a plain count/total rather than growing into a full per-line review step —
          every line is already visible, individually removable, in the staged list above. */}
      <ConfirmModal
        open={confirmOpen}
        title="Confirm this transfer"
        body={`Move ${stagedLines.length} line${stagedLines.length === 1 ? '' : 's'} (${stagedTotalSets} set${
          stagedTotalSets === 1 ? '' : 's'
        } total) from ${locations.find((l) => l.id === fromLocationId)?.name ?? ''} to ${
          stagedDestinations.size === 1 ? [...stagedDestinations][0] : 'the locations shown above'
        }. Live stock updates immediately at both locations.`}
        confirmLabel="Transfer stock"
        tone="accent"
        onConfirm={handleConfirmedSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
