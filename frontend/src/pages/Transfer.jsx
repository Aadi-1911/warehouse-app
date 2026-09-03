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
//
// The search-results list (2026-08-28) reuses this same "group by Article, select via chips"
// shape for its own, unrelated reason: search results are a flat list that can span several
// Articles (and, unlike the browsing view, several Factories) at once, so grouping by Article
// first is what lets it stage several colours across different Articles in one search without a
// second selection UI. See buildArticleGroups/searchArticleGroups and renderSearchGroupHeader.
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

  // { [bundleId]: { sets: number } } — present only for CHECKED colours, shared by BOTH the
  // Factory→Article browsing view AND the search-results list (2026-08-28: search grouped by
  // Article and switched onto this same mechanism — see buildArticleGroups/searchArticleGroups
  // further down for how a flat, cross-Factory search result becomes the same per-Article shape
  // this mechanism was already built around).
  // Same shape as New Order's own checkedColors. Checking a chip reveals that colour's inline
  // stepper; unchecking drops the entry and its in-progress quantity. bundleId (not colorId) is
  // the key because that's this screen's own unique-selection-unit (see this file's own
  // top-of-file note on why a Stock row, not an article+colour cascade, is what's selected here)
  // — two different Articles, even across different Factories, can never collide on the same
  // bundleId, which is exactly what lets one flat map serve both a Factory-scoped browsing view
  // and a Factory-spanning search list with no cross-context ambiguity.
  //
  // Until 2026-08-28, search instead used a separate one-at-a-time mechanism (a kept-whole
  // `selectedRow` + `qtySets` + an optional `note`, staged via an explicit "+ Add to transfer"
  // button) — a real, since-fixed inconsistency: two different selection idioms on one screen,
  // for no reason tied to what a Transfer actually is. That mechanism is gone entirely now, not
  // just unused by search — it was ALREADY true (per its own comment) that nothing else on this
  // screen used it, so retiring search onto checkedColors left no remaining caller. One concrete,
  // disclosed consequence: the optional per-line note is gone too, since the chip/"Add selected"
  // mechanism has no note concept anywhere (matching New Order) — confirmed as the intended
  // tradeoff rather than an oversight before this was built.
  const [checkedColors, setCheckedColors] = useState({});

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
    setSearch('');
    setStagedLines([]);
    // The Factory dropdown's own options are derived from THIS location's rows (see
    // factoryOptions below) — a new location can offer an entirely different set of Factories,
    // so the previous selection (and whichever articles were left expanded under it) can't
    // carry over meaningfully.
    setFactoryId('');
    setExpandedArticles(new Set());
    // checkedColors is exactly "any in-progress selection, browsing or search" in the chip
    // mechanism's own terms — every checked colour's remaining-quantity cap is computed against
    // THIS location's stock, so a location switch invalidates all of it unconditionally, the same
    // way it invalidates the search box just above. stagedLines is still deliberately left alone
    // (cleared just above, for its own separate reason: every staged line so far genuinely was
    // built from the OLD location).
    setCheckedColors({});
    // Clearing a to-location that now equals the new from-location is what keeps the two
    // dropdowns from ever agreeing (the backend rejects it, but the UI shouldn't offer it).
    if (newId === toLocationId) setToLocationId('');
  }

  // A new Factory means an entirely different set of Articles on screen — collapse everything and
  // drop the whole in-progress checked-colour map unconditionally, the same reasoning
  // handleFromLocationChange uses for a Location switch (and per this task's own explicit
  // requirement: this reset must behave EXACTLY as it did before search shared the same map —
  // it does not attempt to selectively preserve colours checked under a different Factory via
  // search, only a full clear, matching prior behaviour). stagedLines is deliberately left
  // untouched: a staged line is tied to the source Location it was picked from (fromLocationId),
  // not to which Factory is currently being BROWSED, so a line staged while looking at a
  // different Factory stays perfectly valid and stays staged.
  function handleFactoryChange(newFactoryId) {
    setFactoryId(newFactoryId);
    setExpandedArticles(new Set());
    setCheckedColors({});
  }

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function handleRemoveStaged(lineId) {
    setStagedLines((prev) => prev.filter((l) => l.id !== lineId));
  }

  // Same shape as New Order's own toggleColorChip — a checked chip starts its stepper at 0
  // (never pre-filled with the max), so an owner always makes a deliberate choice of quantity
  // rather than accidentally batch-moving a colour's entire remaining stock by just tapping it.
  function toggleColorChip(bundleId) {
    setCheckedColors((prev) => {
      const next = { ...prev };
      if (next[bundleId]) {
        delete next[bundleId];
      } else {
        next[bundleId] = { sets: 0 };
      }
      return next;
    });
  }

  // Capped at `max` (that colour's real remaining quantity — see remainingForRow) on both ends,
  // unlike New Order's own setColorSets, which only floors at 0 and has no ceiling at all (rule
  // 64: ordering more than what's in stock is allowed there; a Transfer moves real physical
  // stock, so it cannot be allowed to request more than genuinely exists at the source).
  function setColorChipSets(bundleId, sets, max) {
    setCheckedColors((prev) => ({ ...prev, [bundleId]: { sets: Math.max(0, Math.min(max, sets)) } }));
  }

  // Stages every currently-checked colour belonging to THIS ONE article as one batch — matching
  // New Order's handleAddSelected exactly, adapted for Transfer's flat (not per-article-grouped)
  // stagedLines shape: one line per colour, same as every other staged line on this screen.
  // Clears only THIS article's own bundleIds out of checkedColors afterward, not the whole map —
  // several different articles can be mid-selection simultaneously (several expanded in the
  // browsing view, or several matched at once in a search), and adding one of them must never
  // discard progress checked under a different one.
  //
  // Takes the same `{ productId, articleNo, rows }` shape regardless of which caller built it —
  // the browsing view's Factory-filtered `articleGroups` or search's Factory-spanning
  // `searchArticleGroups` (2026-08-28, see buildArticleGroups below) — because this function only
  // ever reads `article.rows` and keys everything off each row's own `bundleId`, which is
  // globally unique with no per-Factory scoping to get confused by. Confirmed by real testing,
  // not just by this reasoning: checking colours under two DIFFERENT articles surfaced by the
  // same search, then clicking "Add selected" on only one of them, leaves the other article's
  // checked chips exactly as they were.
  //
  // No note field on this path — matching New Order's own chip mechanism, which has no note
  // concept at all. A batch of several colours staged in one click has no single row to attach a
  // free-text note to; the older search-based single-select flow used to offer one, but that
  // mechanism is gone entirely as of 2026-08-28 (see the checkedColors state comment above) —
  // dropping the note capability was a confirmed, deliberate tradeoff, not an oversight.
  function handleAddSelectedForArticle(article) {
    const toAdd = article.rows.filter((row) => (checkedColors[row.bundleId]?.sets ?? 0) > 0);
    if (toAdd.length === 0 || !toLocationId) return;

    const fromLocationName = locations.find((l) => l.id === fromLocationId)?.name ?? '';
    const toLocationName = locations.find((l) => l.id === toLocationId)?.name ?? '';

    setStagedLines((prev) => [
      ...prev,
      ...toAdd.map((row) => ({
        id: nextLineIdRef.current++,
        bundleId: row.bundleId,
        articleNo: row.productArticleNo,
        colorName: row.colorName,
        qtySets: checkedColors[row.bundleId].sets,
        fromLocationId,
        fromLocationName,
        toLocationId,
        toLocationName,
        note: undefined,
      })),
    ]);

    setCheckedColors((prev) => {
      const next = { ...prev };
      toAdd.forEach((row) => delete next[row.bundleId]);
      return next;
    });
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

  // No finalizeActiveLine step any more — every line reaches stagedLines only through an explicit
  // "Add selected" click (handleAddSelectedForArticle), never through an implicit "whatever's
  // active right now" fold-in, since there's no single "active row" concept left on this screen
  // once search adopted the same chip mechanism as browsing.
  function handleOpenConfirm() {
    if (stagedLines.length === 0) return;
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
    // against whatever's CURRENTLY in stagedLines, not a flat replace: staging is disabled while
    // submitting (every chip/stepper/"Add selected" control below passes disabled={submitting}),
    // but this is the backstop in case that's ever bypassed — `lines` is a snapshot from the
    // START of this submission, so anything in current state that wasn't part of that snapshot
    // was staged mid-submit and must survive, not be silently clobbered by overwriting state with
    // a stale plan.
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
  // the Article groups are all derived from an identical, consistent set of rows. "currently
  // being configured" means checkedColors now, in either context (browsing or search) — a colour
  // checked down to its last available set must stay visible with its chip still checked, not
  // vanish out from under an owner mid-selection.
  const availableRows = sourceStock.filter(
    (r) => remainingForRow(r) > 0 || checkedColors[r.bundleId] !== undefined
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

  // Groups any set of rows by Article — shared by the Factory→Article browsing view (only rows
  // under the currently selected Factory) and, as of 2026-08-28, the search-results list (rows
  // spanning any number of Factories at once, unfiltered). productId is the group key rather than
  // articleNo because article numbers are only unique PER Factory (rule 54) — two different
  // Factories can legitimately share an article number, and productId (a real, globally-unique
  // row id) can never collide the way a raw articleNo string could across Factories. factoryId/
  // factoryName ride along on every group unconditionally (not just when it's actually needed):
  // the browsing view's caller already knows which Factory it filtered to and simply doesn't
  // render them, while search's caller needs them to disambiguate two identically-numbered
  // articles from different Factories in one flat, cross-Factory list — one function serving both
  // shapes correctly is simpler than two near-identical ones that could drift.
  // Array.from(Map.values()) preserves first-seen order; sorted by articleNo afterward for a
  // stable, predictable list rather than raw fetch order.
  function buildArticleGroups(rows) {
    const byProduct = new Map();
    for (const row of rows) {
      if (!byProduct.has(row.productId)) {
        byProduct.set(row.productId, {
          productId: row.productId,
          articleNo: row.productArticleNo,
          factoryId: row.factoryId,
          factoryName: row.factoryName,
          rows: [],
        });
      }
      byProduct.get(row.productId).rows.push(row);
    }
    return Array.from(byProduct.values()).sort((a, b) => a.articleNo.localeCompare(b.articleNo));
  }

  const articleGroups = factoryId ? buildArticleGroups(availableRows.filter((r) => r.factoryId === factoryId)) : [];

  // Search's own Article grouping (2026-08-28) — the whole reason this task exists. A flat search
  // can match rows across several different Articles (and, unlike the browsing view, several
  // different Factories) at once; grouping by productId first lets each group render through the
  // exact same renderArticleChips the browsing view already uses, rather than a second selection
  // UI built just for search. Deliberately NOT filtered to any Factory — search already bypasses
  // Factory scoping entirely (requirement 3), searching the whole Location regardless of which
  // Factory is selected in the (hidden, while searching) dropdown.
  const searchArticleGroups = searchText ? buildArticleGroups(searchResults) : [];

  // The source location is removed from the destination list entirely — the backend rejects a
  // same-location transfer with SAME_LOCATION, but an option that can only ever produce an
  // error shouldn't be offered in the first place.
  const destinationOptions = locations.filter((l) => l.id !== fromLocationId);

  // No "in-progress single row" concept left to fold in here — every line reaches stagedLines
  // through an explicit "Add selected" click now, so opening the confirm step just needs
  // something to confirm.
  const canOpenConfirm = stagedLines.length > 0 && !submitting;

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

  // Search's own group header (2026-08-28) — a plain, non-collapsible label above each Article's
  // chips, styled with the same accordion-header-text/accordion-title-sm classes the browsing
  // view's real (clickable) accordion header uses, but with no button/chevron: unlike browsing,
  // where a Factory is already chosen and only a MULTI-colour Article gets a header at all (a
  // single-colour one renders its chip directly, no header, since nothing needs disambiguating
  // within an already-Factory-scoped list), search results have no such shared context — a search
  // can surface rows from several different Factories at once, and article numbers are only
  // unique PER Factory (rule 54), so even a single-colour match needs its own header naming BOTH
  // the article and the factory, or two different Factories' identically-numbered articles would
  // render as indistinguishable chip blocks. Not collapsible on purpose: a search result is
  // already a narrowed, deliberately-sought-out list, so hiding it behind an extra click a person
  // would have to already know to make would undercut the reason they searched in the first
  // place — this is a considered UX choice, not a shortcut, and it's the one place search's
  // grouped rendering visibly differs from the browsing view it reuses renderArticleChips from.
  function renderSearchGroupHeader(article) {
    return (
      <div className="accordion-header-text transfer-search-group-header">
        <div className="accordion-title-sm">{article.articleNo}</div>
        <div className="accordion-subtitle">
          <span className="muted">{article.factoryName}</span>
        </div>
      </div>
    );
  }

  // The Factory→Article browsing view's own row mechanism (2026-08-26) — checkable colour chips
  // within one Article, each checked chip revealing its own inline stepper, one "Add selected"
  // button staging every currently-checked colour in THIS article as one batch. Matches New
  // Order's chip+stepper+"Add selected" shape exactly (see NewOrder.jsx's own toggleColorChip/
  // setColorSets/handleAddSelected), with the one deliberate difference investigation confirmed
  // was necessary: each chip's stepper is capped at remainingForRow(row) — this moves real
  // physical stock, unlike New Order's uncapped stepper (rule 64 allows over-ordering there; a
  // Transfer cannot move more than a location actually holds). The atomic server-side guard in
  // createTransfer (transferController.js) remains the real enforcement regardless — this cap is
  // a UX improvement on the happy path, not a replacement for it.
  function renderArticleChips(article) {
    const anyChecked = article.rows.some((row) => (checkedColors[row.bundleId]?.sets ?? 0) > 0);
    return (
      <div className="transfer-article-chips">
        <div className="chip-row">
          {article.rows.map((row) => {
            const checked = checkedColors[row.bundleId] !== undefined;
            const remaining = remainingForRow(row);
            return (
              <button
                key={row.bundleId}
                type="button"
                className={`chip ${checked ? 'chip-selected' : ''}`}
                onClick={() => toggleColorChip(row.bundleId)}
                aria-pressed={checked}
                disabled={submitting}
              >
                {row.colorName}
                <span className="muted"> · {remaining} set{remaining === 1 ? '' : 's'}</span>
              </button>
            );
          })}
        </div>

        {article.rows
          .filter((row) => checkedColors[row.bundleId] !== undefined)
          .map((row) => {
            const sets = checkedColors[row.bundleId].sets;
            const max = remainingForRow(row);
            return (
              <div key={row.bundleId} className="color-chip-block">
                <span className="field-label">{row.colorName}</span>
                <div className="color-chip-block-stepper-row">
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setColorChipSets(row.bundleId, sets - 1, max)}
                      disabled={sets === 0}
                      aria-label={`Decrease ${row.colorName} sets`}
                    >
                      −
                    </button>
                    <span className="stepper-value">{sets}</span>
                    {/* Capped at `max` on both sides — see this function's own header comment
                        for why this differs from New Order's uncapped equivalent. */}
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setColorChipSets(row.bundleId, sets + 1, max)}
                      disabled={sets >= max}
                      aria-label={`Increase ${row.colorName} sets`}
                    >
                      +
                    </button>
                  </div>
                  <span className="muted">
                    {max} set{max === 1 ? '' : 's'} available
                  </span>
                </div>
              </div>
            );
          })}

        {anyChecked && (
          <button
            type="button"
            className="btn-primary btn-inline"
            onClick={() => handleAddSelectedForArticle(article)}
            disabled={!toLocationId || submitting}
          >
            Add selected
          </button>
        )}
      </div>
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
          // Search results, grouped by Article (2026-08-28) — same chip+stepper+"Add selected"
          // mechanism as the browsing view below, via the shared renderArticleChips, so there is
          // only ever ONE selection UI on this screen. Still works across every Factory at once,
          // unchanged (requirement 3) — grouping is purely a rendering change, not a new filter.
          // Every group gets its own header (see renderSearchGroupHeader) naming both the article
          // and its Factory, since search can surface two different Factories' articles that
          // happen to share a number (rule 54) side by side in one flat list.
          <div className="transfer-stock-list">
            {searchArticleGroups.map((article) => (
              <div key={article.productId} className="transfer-search-group">
                {renderSearchGroupHeader(article)}
                {renderArticleChips(article)}
              </div>
            ))}
          </div>
        ) : (
          // Factory → Article (collapsible) → Colour hierarchy (07_UI_DESIGN_BRIEF.md §5.9
          // amendment), scoped to the chosen Factory. Reuses Live Stock's shared accordion
          // classes as-is (LiveStock.jsx/index.css) — this is a single level of accordion, not
          // Live Stock's two (Factory here is a dropdown, not its own accordion layer, since
          // only one Factory's articles are ever visible at a time). Colour selection within
          // (both here and the single-colour case below) is the new chip+stepper+"Add selected"
          // mechanism (2026-08-26, matching New Order) — see renderArticleChips.
          <div className="transfer-stock-list">
            {articleGroups.map((article) => {
              // An article with exactly one colour has nothing to disambiguate — collapsing it
              // behind a header + chevron would be a click for no reason, so it renders as a
              // plain row directly, same as Live Stock's single-Location collapse (§5.5). Still
              // gets the chip+stepper+"Add selected" treatment, just with no accordion wrapper
              // around it — renderArticleChips itself renders no accordion markup at all, so
              // calling it directly here already satisfies "no wrapper for one item" by
              // construction, with no separate branch needed.
              if (article.rows.length === 1) {
                return <div key={article.productId}>{renderArticleChips(article)}</div>;
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

                  {expanded && <div className="accordion-body nested">{renderArticleChips(article)}</div>}
                </div>
              );
            })}
          </div>
        )}

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
