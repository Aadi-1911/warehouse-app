import { useState } from 'react';
import { listProducts, getValidColors } from '../api/products';
import {
  buildPersonGroups,
  buildMonthGroups,
  buildBiweeklyGroups,
  yearOptionsFor,
  entriesForYear,
} from '../utils/historyGrouping';

// History's "Group by" drill-down controls (2026-08-29) — shared by BOTH mobile History.jsx and
// dashboard/History.jsx for the same reason utils/historyGrouping.js's bucketing rules are shared:
// the actual FILTERING math already lives there as pure functions, but the CONTROL WIDGETS
// themselves (which dropdown, which fields, the article search/disambiguation flow) are real
// interactive UI, not pure data — if each screen re-built its own copy of this, the two could
// silently drift on something as basic as which factory a disambiguation chip resolves to. This
// component owns exactly that shared control surface and nothing else: it never renders a single
// history row or day-section itself (that stays each screen's own responsibility, unchanged from
// before, since dashboard's rows carry a Correct affordance mobile's don't) — it only reports
// "here is the specific value the viewer picked" back up via onChange-style callbacks, fired from
// real user actions (a click, a resolved search), never from inside render.
//
// Chronological is NEVER passed to this component — each screen still renders that mode exactly
// as before, with no drill-down step at all, matching Aadi's own explicit carve-out.
//
// Article's search reuses New Order's own exact pattern (see NewOrder.jsx's handleSearchArticle):
// listProducts({ articleNo }) narrowed client-side to a real case-insensitive exact + isActive
// match, with rule-54 disambiguation chips (one per Factory) when more than one Factory has the
// same number. The one addition beyond New Order's own flow: once a single Product is resolved,
// this also fetches getValidColors(productId) — the same endpoint New Order/Receive Stock already
// call for their own colour chips — purely to collect that Product's own bundleIds. Those are what
// actually get handed to the parent (via onArticleResolved), because a bare articleNo string is
// NOT enough to filter safely: articleNo is only unique per Factory (rule 54), and this app has a
// real live collision today ("6099" is both Comeco's "ad" and RDX's "Balenciaga", each with real
// history) — filtering `entries` by the string alone would silently merge the two. See
// entriesForBundleIds's own comment in historyGrouping.js for the full reasoning; this component
// is just where that resolved id set gets produced.
//
// Month/Bi-weekly's Year step (2026-08-30): these two are the only modes whose own dropdown grows
// unboundedly with time, so they ask for a year first via yearOptionsFor/entriesForYear
// (historyGrouping.js), then build the existing Month/Bi-weekly option list from just that year's
// entries — reusing buildMonthGroups/buildBiweeklyGroups unchanged, never a parallel
// year-aware version of either.
//
// Callers MUST render this with `key={groupMode}` (see both History.jsx files). Without it,
// switching modes doesn't unmount this component (same element type, same tree position), so its
// OWN local state — Article's resolvedProduct/disambiguationOptions, Month/Bi-weekly's
// selectedYear — would silently survive the switch: leaving Article and coming back would still
// show a stale resolved banner for whatever was picked last time, even though the parent's own
// drillValue/articleBundleIds were correctly cleared by handleGroupModeChange. Keying on groupMode
// forces a real remount on every mode change, which is what actually resets this component's local
// state to match the parent's already-reset state.
export default function HistoryGroupingDrilldown({
  groupMode,
  entries,
  locations,
  factories,
  selectedValue,
  onSelectValue,
  onArticleResolved,
  onArticleResolvingChange,
  onArticleCleared,
  dateStart,
  dateEnd,
  onDateStartChange,
  onDateEndChange,
}) {
  // --- Article's own local search-flow state — mirrors NewOrder.jsx's shape exactly (same field
  // names even) so the two are trivially comparable if either ever needs to change. Local, not
  // lifted to the parent screens: it's transient "search in progress" UI state, the same kind
  // Receive Stock/New Order/the dashboard's own correction form already each keep local to
  // themselves rather than threading through a parent.
  const [articleNo, setArticleNo] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState(null);
  const [resolvedProduct, setResolvedProduct] = useState(null);

  // --- Month/Bi-weekly's Year step (2026-08-30). Local, same reasoning as Article's own search
  // state above: it's a staging step on the way to a commit, not itself something the parent's
  // filtering needs — the Month/Bi-weekly heading a viewer eventually picks already carries its
  // own year in the string ("August 2026", "16–31 Aug 2026"), so entriesForMonth/entriesForBiweekly
  // don't need to know which year narrowed the dropdown that produced it.
  const [selectedYear, setSelectedYear] = useState(null);

  function handleYearChange(value) {
    const year = value ? Number(value) : null;
    setSelectedYear(year);
    // Changing (or clearing) the year invalidates whatever period was already picked under the
    // PREVIOUS year — that heading may not even be in the new year's option list — so the parent's
    // committed selection is cleared rather than left pointing at a period no longer offered.
    onSelectValue(null);
  }

  function factoryName(factoryId) {
    return factories.find((f) => f.id === factoryId)?.name ?? 'Unknown Factory';
  }

  function resetArticleSearch() {
    setArticleNo('');
    setSearchError(null);
    setDisambiguationOptions(null);
    setResolvedProduct(null);
    onArticleResolvingChange(false);
    onArticleCleared();
  }

  async function resolveToProduct(product) {
    setResolvedProduct(product);
    setDisambiguationOptions(null);
    // A real network round-trip sits between "a specific article is picked" (the banner above
    // already shows it) and "the parent actually has a bundleId set to filter by." Without this
    // flag, the parent's only signal is articleBundleIds staying null, which is indistinguishable
    // from "nothing picked yet" — the exact aliased-loading-state trap this app's own standing
    // rule (CLAUDE.md) warns against elsewhere. Confirmed as a real, reproducible gap, not a
    // hypothetical: this Product's colours came back slow enough in testing (real network latency
    // to Neon) that the parent briefly rendered "Pick a value above..." while a value very much
    // had been picked and was just still loading.
    onArticleResolvingChange(true);
    try {
      const colors = await getValidColors(product.id);
      onArticleResolved({
        bundleIds: colors.map((c) => c.bundleId),
        articleNo: product.articleNo,
        factoryName: factoryName(product.factoryId),
      });
    } catch (err) {
      // `resolvedProduct` was set optimistically above (so the banner shows the picked article
      // immediately, before its bundleIds are known) — if the bundleId fetch itself fails, leaving
      // resolvedProduct truthy would keep rendering the success banner below with no bundleIds
      // ever having reached the parent and no error visible anywhere (the error banner only renders
      // in the !resolvedProduct branch). Clearing it here falls back to the visible search/error UI,
      // the same state a failed initial search already lands in.
      setResolvedProduct(null);
      setSearchError(err.message);
    } finally {
      onArticleResolvingChange(false);
    }
  }

  async function handleSearchArticle() {
    setSearchError(null);
    setDisambiguationOptions(null);
    const trimmed = articleNo.trim();
    if (!trimmed) {
      setSearchError('Enter an article number.');
      return;
    }
    setSearching(true);
    try {
      const results = await listProducts({ articleNo: trimmed });
      const exact = results.filter((p) => p.articleNo.toLowerCase() === trimmed.toLowerCase() && p.isActive);
      if (exact.length === 0) {
        setSearchError(`No active article found with number "${trimmed}".`);
      } else if (exact.length === 1) {
        await resolveToProduct(exact[0]);
      } else {
        // Rule 54: more than one Factory has this exact number — same chip pattern New Order
        // uses, one chip per Factory, not a guess and not a silent merge.
        setDisambiguationOptions(exact);
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  // Dropdown OPTION lists for Person/Month/Bi-weekly come straight from the already-loaded,
  // already-role-filtered `entries` — the exact same grouping functions the old "show every
  // bucket" view used, just read for their headings/names instead of their contents. Location's
  // options come from the real /api/locations list instead (every existing location, not just
  // ones with history so far) per this task's own investigation finding.
  const personOptions = groupMode === 'person' ? buildPersonGroups(entries).map((g) => g.actorName) : [];

  // Month/Bi-weekly go through the Year step first — their own option lists are only ever built
  // from that year's already-narrowed entries (reusing buildMonthGroups/buildBiweeklyGroups
  // unchanged, never a separate year-aware implementation), and stay empty until a year is picked.
  const yearOptions = groupMode === 'month' || groupMode === 'biweekly' ? yearOptionsFor(entries) : [];
  const yearFilteredEntries = selectedYear ? entriesForYear(entries, selectedYear) : [];
  const monthOptions =
    groupMode === 'month' && selectedYear ? buildMonthGroups(yearFilteredEntries).map((g) => g.heading) : [];
  const biweeklyOptions =
    groupMode === 'biweekly' && selectedYear
      ? buildBiweeklyGroups(yearFilteredEntries).map((g) => g.heading)
      : [];

  const hasValue = groupMode === 'article' ? !!resolvedProduct : !!selectedValue;

  return (
    <div className="history-drilldown">
      {groupMode === 'person' && (
        <label className="field">
          <span className="field-label">Person</span>
          <select value={selectedValue ?? ''} onChange={(e) => onSelectValue(e.target.value || null)}>
            <option value="">Select a person…</option>
            {personOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {groupMode === 'location' && (
        <label className="field">
          <span className="field-label">Location</span>
          <select value={selectedValue ?? ''} onChange={(e) => onSelectValue(e.target.value || null)}>
            <option value="">Select a location…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {groupMode === 'month' && (
        <>
          <label className="field">
            <span className="field-label">Year</span>
            <select value={selectedYear ?? ''} onChange={(e) => handleYearChange(e.target.value)}>
              <option value="">Select a year…</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {selectedYear && (
            <label className="field">
              <span className="field-label">Month</span>
              <select value={selectedValue ?? ''} onChange={(e) => onSelectValue(e.target.value || null)}>
                <option value="">Select a month…</option>
                {monthOptions.map((heading) => (
                  <option key={heading} value={heading}>
                    {heading}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {groupMode === 'biweekly' && (
        <>
          <label className="field">
            <span className="field-label">Year</span>
            <select value={selectedYear ?? ''} onChange={(e) => handleYearChange(e.target.value)}>
              <option value="">Select a year…</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {selectedYear && (
            <label className="field">
              <span className="field-label">Bi-weekly period</span>
              <select value={selectedValue ?? ''} onChange={(e) => onSelectValue(e.target.value || null)}>
                <option value="">Select a period…</option>
                {biweeklyOptions.map((heading) => (
                  <option key={heading} value={heading}>
                    {heading}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {groupMode === 'article' && (
        <div className="field">
          <span className="field-label">Article No.</span>
          {!resolvedProduct ? (
            <>
              <div className="article-lookup-row">
                <input
                  type="text"
                  value={articleNo}
                  onChange={(e) => setArticleNo(e.target.value)}
                  placeholder="e.g. 6099"
                  autoCapitalize="characters"
                />
                <button
                  type="button"
                  className="btn-primary btn-inline"
                  onClick={handleSearchArticle}
                  disabled={searching}
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {searchError && (
                <p className="error-banner" role="alert">
                  {searchError}
                </p>
              )}
              {disambiguationOptions && (
                <div className="chip-row">
                  {disambiguationOptions.map((p) => (
                    <button key={p.id} type="button" className="chip" onClick={() => resolveToProduct(p)}>
                      {p.name} — {factoryName(p.factoryId)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="lookup-banner lookup-banner-success">
              <p>
                <strong>{resolvedProduct.articleNo}</strong> — {resolvedProduct.name} ({factoryName(resolvedProduct.factoryId)})
              </p>
              <button type="button" className="link-button" onClick={resetArticleSearch}>
                Change
              </button>
            </div>
          )}
        </div>
      )}

      {hasValue && (
        <div className="field-row">
          <label className="field">
            <span className="field-label">From (optional)</span>
            <input type="date" value={dateStart ?? ''} onChange={(e) => onDateStartChange(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">To (optional)</span>
            <input type="date" value={dateEnd ?? ''} onChange={(e) => onDateEndChange(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
