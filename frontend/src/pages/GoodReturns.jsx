import { useEffect, useState } from 'react';
import { ReturnIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import CreatableSelect from '../components/CreatableSelect';
import { useAuth } from '../hooks/useAuth';
import { listParties } from '../api/parties';
import { listFactories } from '../api/factories';
import { listLocations, createLocation } from '../api/locations';
import { listProducts, getValidColors } from '../api/products';
import { createReturns } from '../api/returns';

// Good Returns — logging whole sets a Party has sent back (05_BUSINESS_RULES.md rule 86).
// Any authenticated role: taking returned goods at the counter is a staff job, same as receiving
// stock or placing an order, so there is no requireRole on this route or on POST /api/returns.
//
// Structurally this IS New Order's screen with the direction reversed — party picker, article
// search, checkable colour chips, a per-colour stepper, "Add" commits the group into a running
// list. That similarity is deliberate and reused rather than reinterpreted: the same staff use
// the same interaction shape for both, and a return that behaved differently for no reason would
// be a worse screen, not a more thoughtful one.
//
// Three things genuinely differ from New Order, each for a real reason:
//   1. A destination Location, because a return puts stock back somewhere specific. That reuses
//      Receive Stock's own CreatableSelect picker (now shared, components/CreatableSelect.jsx).
//   2. A reason (and conditionally a note) per staged group — the required GoodReturnReason.
//   3. No low-stock badge on the colour chips. New Order shows one because ordering draws stock
//      DOWN, so "there's barely any left" is decision-useful. A return adds stock, so the badge
//      would answer a question nobody is asking here.

// Mirrors the GoodReturnReason enum (schema.prisma) — value is what the API receives, label is
// what a human reads. Wording taken from the enum's own schema comments rather than invented, the
// same convention historyController uses for its own label tables, so the words on screen match
// the words the schema documents as that value's meaning.
const REASON_OPTIONS = [
  { value: 'NOT_ORDERED', label: 'Not ordered' },
  { value: 'SIZE_ISSUE', label: 'Size issue' },
  { value: 'COLOUR_NOT_ORDERED', label: 'Colour not ordered' },
  { value: 'COLOUR_BLEEDING', label: 'Colour bleeding' },
  { value: 'ACCESSORIES_ISSUE', label: 'Accessories issue' },
  { value: 'OTHER', label: 'Other' },
];

// The one reason that makes the note mandatory — enforced again server-side (400 NOTE_REQUIRED),
// which is the real enforcement; this constant only drives the UI.
const REASON_REQUIRING_NOTE = 'OTHER';

const REASON_LABELS = Object.fromEntries(REASON_OPTIONS.map((r) => [r.value, r.label]));

// Rule 50's fixed Kids piece counts — same lookup ReceiveStock.jsx and NewOrder.jsx both keep
// locally, for the same reason: a tiny fixed table tied to one business rule, not shared state.
const KIDS_PIECES_BY_LABEL = { '1-5yr': 5, '6-16yr': 6, '12-18yr': 4 };

function piecesPerSetFor(product) {
  return product.isKids
    ? KIDS_PIECES_BY_LABEL[product.sizes[0]?.sizeLabel] ?? 0
    : product.sizes.length;
}

export default function GoodReturns() {
  // Location creation is OWNER-only on the backend (locationController.js) — the same gate
  // ReceiveStock applies to its own Location picker, reused rather than re-decided here.
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  // --- Party picker: the exact filter-chips-over-grouped-list pattern New Order uses (chips per
  // location in use, "All" default, trailing "Other" for parties with no location), reused as-is.
  const [parties, setParties] = useState([]);
  const [partiesStatus, setPartiesStatus] = useState('idle');
  const [partiesError, setPartiesError] = useState(null);
  const [partyChipFilter, setPartyChipFilter] = useState('ALL');
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [partyPickerOpen, setPartyPickerOpen] = useState(true);

  // Only needed to resolve a factoryId into a display name for the disambiguation chips —
  // GET /api/products doesn't join Factory.
  const [factories, setFactories] = useState([]);

  // --- Destination Location: one per return session, exactly like Receive Stock's "one receiving
  // session = one Location" rule. POST /api/returns takes a single locationId for all lines, so
  // this genuinely is session-level rather than per-line.
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');

  // Explicit status, never a bare boolean — "hasn't fetched yet" must be distinguishable from
  // "loaded, found nothing", or the picker would briefly render as a real empty list.
  const [listsStatus, setListsStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    setPartiesStatus('loading');
    setListsStatus('loading');
    Promise.all([listParties(), listFactories(), listLocations()])
      .then(([partyList, factoryList, locationList]) => {
        if (cancelled) return;
        setParties(partyList);
        setFactories(factoryList);
        setLocations(locationList);
      })
      .catch((err) => {
        if (cancelled) return;
        setPartiesError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setPartiesStatus('loaded');
        setListsStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateLocation(name) {
    const location = await createLocation({ name });
    setLocations((prev) => [...prev, location]);
    setLocationId(location.id);
  }

  const activeParties = parties.filter((p) => p.isActive);
  const partyLocations = [...new Set(activeParties.filter((p) => p.location).map((p) => p.location))].sort(
    (a, b) => a.localeCompare(b)
  );

  const partyGroups = (() => {
    const withLocation = activeParties.filter((p) => p.location);
    const withoutLocation = activeParties.filter((p) => !p.location);
    const groups = partyLocations.map((loc) => ({
      label: loc,
      parties: withLocation.filter((p) => p.location === loc).sort((a, b) => a.name.localeCompare(b.name)),
    }));
    if (withoutLocation.length > 0) {
      groups.push({ label: 'Other', parties: [...withoutLocation].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (partyChipFilter === 'ALL') return groups;
    return groups.filter((g) => g.label === partyChipFilter);
  })();

  function handleSelectParty(id) {
    setSelectedPartyId(id);
    setPartyPickerOpen(false);
  }

  const selectedParty = activeParties.find((p) => p.id === selectedPartyId) ?? null;

  // --- Article search: same cross-factory search plus rule 54 disambiguation chips as New Order.
  // Article numbers are unique per Factory, never globally, so an exact match can legitimately
  // return more than one product and the staff member has to say which factory's article it is.
  const [articleNo, setArticleNo] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState(null);
  const [resolvedProduct, setResolvedProduct] = useState(null);

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
      // The backend's articleNo filter is a case-insensitive CONTAINS match, so "A1" also returns
      // "A10" — the exact-match filter below is what makes this correct, same discipline New
      // Order and Receive Stock both apply.
      const results = await listProducts({ articleNo: trimmed });
      const exact = results.filter(
        (p) => p.articleNo.toLowerCase() === trimmed.toLowerCase() && p.isActive
      );

      if (exact.length === 0) {
        setSearchError(`No active article found with number "${trimmed}".`);
      } else if (exact.length === 1) {
        setResolvedProduct(exact[0]);
      } else {
        setDisambiguationOptions(exact);
      }
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function factoryName(factoryId) {
    return factories.find((f) => f.id === factoryId)?.name ?? 'Unknown Factory';
  }

  function resetArticleSearch() {
    setArticleNo('');
    setSearchError(null);
    setDisambiguationOptions(null);
    setResolvedProduct(null);
    setColors([]);
    setColorsStatus('idle');
    setColorsError(null);
    setCheckedColors({});
    setReason('');
    setNote('');
  }

  // --- Colours for the resolved article. Critical Interaction Rule #5: never offer a colour the
  // article doesn't actually have.
  const [colors, setColors] = useState([]);
  const [colorsStatus, setColorsStatus] = useState('idle');
  const [colorsError, setColorsError] = useState(null);
  // { [colorId]: { sets } } — present only for CHECKED colours, which is what reveals that
  // colour's own stepper. Unchecking drops the entry and its in-progress quantity.
  const [checkedColors, setCheckedColors] = useState({});

  // Reason and note apply to the whole group being staged, not per colour — a Party sending back
  // three colours of one article almost always sends them back for one reason, and asking the
  // same question three times would be worse. Staging the same article twice with two different
  // reasons is still fully supported: each "Add" captures its own reason.
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!resolvedProduct) {
      setColorsStatus('idle');
      return;
    }

    let cancelled = false;
    setColorsStatus('loading');
    setColorsError(null);
    getValidColors(resolvedProduct.id)
      .then((list) => {
        if (!cancelled) setColors(list);
      })
      .catch((err) => {
        if (!cancelled) setColorsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setColorsStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedProduct]);

  function toggleColorChip(colorId) {
    setCheckedColors((prev) => {
      const next = { ...prev };
      if (next[colorId]) {
        delete next[colorId];
      } else {
        next[colorId] = { sets: 0 };
      }
      return next;
    });
  }

  function setColorSets(colorId, sets) {
    setCheckedColors((prev) => ({ ...prev, [colorId]: { sets: Math.max(0, sets) } }));
  }

  // --- Staged returns. One entry per "Add" action; merged for display by productId below, the
  // same convention New Order's summary and Receive Stock's receipt table both use.
  const [returnEntries, setReturnEntries] = useState([]);
  const [nextEntryId, setNextEntryId] = useState(0);

  const noteMissing = reason === REASON_REQUIRING_NOTE && !note.trim();
  const canAddSelected =
    Object.values(checkedColors).some((c) => c.sets > 0) && !!reason && !noteMissing;

  function handleAddSelected() {
    const colorsToAdd = colors
      .filter((c) => checkedColors[c.id]?.sets > 0)
      .map((c) => ({
        colorId: c.id,
        colorName: c.name,
        bundleId: c.bundleId,
        sets: checkedColors[c.id].sets,
      }));
    if (colorsToAdd.length === 0) return;

    setReturnEntries((prev) => [
      ...prev,
      {
        id: nextEntryId,
        productId: resolvedProduct.id,
        articleNo: resolvedProduct.articleNo,
        productName: resolvedProduct.name,
        piecesPerSet: piecesPerSetFor(resolvedProduct),
        reason,
        note: note.trim(),
        colors: colorsToAdd,
      },
    ]);
    setNextEntryId((n) => n + 1);
    resetArticleSearch();
  }

  // Removes ONE colour line, not the whole article group. An entry left with no colours is
  // dropped entirely, so an empty group never renders.
  function handleRemoveLine(entryId, colorId) {
    setReturnEntries((prev) =>
      prev
        .map((e) => (e.id === entryId ? { ...e, colors: e.colors.filter((c) => c.colorId !== colorId) } : e))
        .filter((e) => e.colors.length > 0)
    );
  }

  const groupedReturns = returnEntries.reduce((groups, entry) => {
    let group = groups.find((g) => g.productId === entry.productId);
    if (!group) {
      group = { productId: entry.productId, articleNo: entry.articleNo, productName: entry.productName, rows: [] };
      groups.push(group);
    }
    entry.colors.forEach((c) => {
      group.rows.push({
        entryId: entry.id,
        colorId: c.colorId,
        colorName: c.colorName,
        sets: c.sets,
        pieces: c.sets * entry.piecesPerSet,
        reason: entry.reason,
        note: entry.note,
      });
    });
    return groups;
  }, []);

  const totalLineCount = returnEntries.reduce((sum, e) => sum + e.colors.length, 0);
  const totalSets = returnEntries.reduce(
    (sum, e) => sum + e.colors.reduce((s, c) => s + c.sets, 0),
    0
  );

  // Shared accordion state — Live Stock's own .accordion-* classes, reused rather than a bespoke
  // implementation. Collapsed by default, matching every other accordion in this app.
  const [expandedArticles, setExpandedArticles] = useState(() => new Set());

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // --- Submit.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [loggedOutcome, setLoggedOutcome] = useState(null);

  function resetScreen() {
    setSelectedPartyId('');
    setPartyPickerOpen(true);
    setPartyChipFilter('ALL');
    setLocationId('');
    resetArticleSearch();
    setReturnEntries([]);
    setExpandedArticles(new Set());
  }

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    // Captured before resetScreen() clears the state these read from — reading them after the
    // reset would just read the emptied values.
    const partyName = selectedParty?.name ?? '';
    const locationName = locations.find((l) => l.id === locationId)?.name ?? '';
    const lineCount = totalLineCount;
    const setCount = totalSets;

    const lines = returnEntries.flatMap((e) =>
      e.colors.map((c) => ({
        bundleId: c.bundleId,
        qtySets: c.sets,
        reason: e.reason,
        // Sent as undefined rather than '' when empty, so the body carries no key at all for a
        // note that wasn't written — the server normalises either way, but this keeps the
        // request honest about what was actually entered.
        note: e.note || undefined,
      }))
    );

    try {
      await createReturns({ partyId: selectedPartyId, locationId, lines });
      resetScreen();
      setLoggedOutcome({ partyName, locationName, lineCount, setCount });
    } catch (err) {
      // Deliberately resets nothing — a Party archived or an article's price unset between
      // staging and submitting is realistic (another session made the change), and must never
      // cost staff their staged work. They fix the cause and press the button again.
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const sessionReady = !!selectedPartyId && !!locationId;

  return (
    <div className="page">
      <ScreenHeader icon={<ReturnIcon size={20} />} tone="warning" title="Good Returns" />

      {loggedOutcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>
              Return logged for {loggedOutcome.partyName}
              {loggedOutcome.locationName ? ` into ${loggedOutcome.locationName}` : ''}.
            </strong>{' '}
            {loggedOutcome.lineCount} line{loggedOutcome.lineCount === 1 ? '' : 's'} ·{' '}
            {loggedOutcome.setCount} set{loggedOutcome.setCount === 1 ? '' : 's'} added back to stock.
          </p>
          <button type="button" className="link-button" onClick={() => setLoggedOutcome(null)}>
            OK
          </button>
        </div>
      )}

      {partiesError && (
        <p className="error-banner" role="alert">
          Could not load parties: {partiesError}
        </p>
      )}

      <div className="card">
        <h2 className="card-title">Party</h2>

        {partiesStatus !== 'loaded' && <p className="muted centered-empty-state">Loading…</p>}

        {partiesStatus === 'loaded' && !partyPickerOpen && selectedParty && (
          <div className="lookup-banner lookup-banner-success">
            <p>
              <strong>{selectedParty.name}</strong>
              {selectedParty.location && <span className="muted"> — {selectedParty.location}</span>}
            </p>
            <button type="button" className="link-button" onClick={() => setPartyPickerOpen(true)}>
              Change
            </button>
          </div>
        )}

        {partiesStatus === 'loaded' && partyPickerOpen && (
          <>
            {activeParties.length === 0 ? (
              <p className="muted centered-empty-state">No parties yet.</p>
            ) : (
              <>
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip ${partyChipFilter === 'ALL' ? 'chip-selected' : ''}`}
                    onClick={() => setPartyChipFilter('ALL')}
                    aria-pressed={partyChipFilter === 'ALL'}
                  >
                    All
                  </button>
                  {partyLocations.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      className={`chip ${partyChipFilter === loc ? 'chip-selected' : ''}`}
                      onClick={() => setPartyChipFilter(loc)}
                      aria-pressed={partyChipFilter === loc}
                    >
                      {loc}
                    </button>
                  ))}
                  {activeParties.some((p) => !p.location) && (
                    <button
                      type="button"
                      className={`chip ${partyChipFilter === 'Other' ? 'chip-selected' : ''}`}
                      onClick={() => setPartyChipFilter('Other')}
                      aria-pressed={partyChipFilter === 'Other'}
                    >
                      Other
                    </button>
                  )}
                </div>

                {partyGroups.map((group) => (
                  <div key={group.label} className="location-subgroup">
                    <div className="location-subgroup-header">{group.label}</div>
                    {group.parties.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="party-option-row"
                        onClick={() => handleSelectParty(p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Receive Stock's own picker component, not a second one built for this screen. Create is
          gated on isOwner for the same reason it is there: POST /api/locations is OWNER-only, so
          offering "+ Create new location…" to staff would produce a guaranteed 403. */}
      <div className="field-row">
        <CreatableSelect
          fieldLabel="Return into"
          value={locationId}
          onChange={setLocationId}
          options={locations}
          disabled={listsStatus !== 'loaded'}
          placeholder={listsStatus !== 'loaded' ? 'Loading…' : 'Select location'}
          canCreate={isOwner}
          onCreate={handleCreateLocation}
        />
      </div>

      <div className="card">
        <h2 className="card-title">Add returned article</h2>

        {!sessionReady && (
          <p className="muted hint-text">Select a Party and a location to begin.</p>
        )}

        {sessionReady && (
          <>
            <div className="article-lookup-row">
              <label className="field article-no-field">
                <span className="field-label">Article No.</span>
                <input
                  type="text"
                  value={articleNo}
                  onChange={(e) => setArticleNo(e.target.value)}
                  disabled={!!resolvedProduct}
                  placeholder="e.g. A101"
                  autoCapitalize="characters"
                />
              </label>
              {!resolvedProduct && (
                <button
                  type="button"
                  className="btn-primary btn-inline"
                  onClick={handleSearchArticle}
                  disabled={searching}
                >
                  {searching ? 'Searching…' : 'Search'}
                </button>
              )}
            </div>

            {searchError && (
              <p className="error-banner" role="alert">
                {searchError}
              </p>
            )}

            {/* Rule 54: the same article number legitimately exists under more than one Factory. */}
            {disambiguationOptions && (
              <div className="chip-row">
                {disambiguationOptions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setResolvedProduct(p);
                      setDisambiguationOptions(null);
                    }}
                  >
                    {p.name} — {factoryName(p.factoryId)}
                  </button>
                ))}
              </div>
            )}

            {resolvedProduct && (
              <>
                <div className="lookup-banner lookup-banner-success">
                  <p>
                    <strong>{resolvedProduct.articleNo}</strong> — {resolvedProduct.name}
                  </p>
                  <button type="button" className="link-button" onClick={resetArticleSearch}>
                    Change
                  </button>
                </div>

                {colorsError && (
                  <p className="error-banner" role="alert">
                    Could not load colors: {colorsError}
                  </p>
                )}

                {colorsStatus !== 'loaded' ? (
                  <p className="muted centered-empty-state">Loading colors…</p>
                ) : colors.length === 0 ? (
                  <p className="muted centered-empty-state">This article has no colors set up yet.</p>
                ) : (
                  <div className="chip-row">
                    {colors.map((c) => {
                      const checked = !!checkedColors[c.id];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={`chip ${checked ? 'chip-selected' : ''}`}
                          onClick={() => toggleColorChip(c.id)}
                          aria-pressed={checked}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {colors
                  .filter((c) => checkedColors[c.id])
                  .map((c) => {
                    const sets = checkedColors[c.id].sets;
                    const pieces = sets * piecesPerSetFor(resolvedProduct);
                    return (
                      <div key={c.id} className="color-chip-block">
                        <span className="field-label">{c.name}</span>
                        <div className="color-chip-block-stepper-row">
                          <div className="stepper">
                            <button
                              type="button"
                              className="stepper-btn"
                              onClick={() => setColorSets(c.id, sets - 1)}
                              disabled={sets === 0}
                              aria-label={`Decrease ${c.name} sets`}
                            >
                              −
                            </button>
                            <span className="stepper-value">{sets}</span>
                            <button
                              type="button"
                              className="stepper-btn"
                              onClick={() => setColorSets(c.id, sets + 1)}
                              aria-label={`Increase ${c.name} sets`}
                            >
                              +
                            </button>
                          </div>
                          <span className="muted">
                            {sets} set{sets === 1 ? '' : 's'} = {pieces} piece{pieces === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                {colorsStatus === 'loaded' && colors.length > 0 && (
                  <>
                    <label className="field">
                      <span className="field-label">Reason for return</span>
                      <select value={reason} onChange={(e) => setReason(e.target.value)}>
                        <option value="">Select a reason</option>
                        {REASON_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Note{reason === REASON_REQUIRING_NOTE ? ' (required)' : ' (optional)'}
                      </span>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          reason === REASON_REQUIRING_NOTE
                            ? 'Describe why these came back'
                            : 'Anything worth recording'
                        }
                      />
                    </label>

                    {/* Says WHY the button is disabled rather than leaving a dead control on
                        screen — "Other" with no note is the one non-obvious rule here, and a
                        silently-greyed button would leave staff guessing. */}
                    {noteMissing && (
                      <p className="muted hint-text">A note is required when the reason is Other.</p>
                    )}

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleAddSelected}
                      disabled={!canAddSelected}
                    >
                      Add selected
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {groupedReturns.length > 0 && (
        <>
          <h2 className="section-heading">Returns to log</h2>
          <div className="card">
            {groupedReturns.map((group) => {
              const open = expandedArticles.has(group.productId);
              return (
                <div key={group.productId} className="accordion-section nested">
                  <button
                    type="button"
                    className="accordion-header nested"
                    onClick={() => toggleArticle(group.productId)}
                    aria-expanded={open}
                  >
                    <div className="accordion-header-text">
                      <div className="accordion-title-sm">
                        {group.articleNo}
                        <span className="muted"> — {group.productName}</span>
                      </div>
                    </div>
                    <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
                  </button>

                  {open && (
                    <div className="accordion-body nested">
                      <div className="staged-list">
                        {group.rows.map((row) => (
                          <div key={`${row.entryId}-${row.colorId}`} className="staged-row">
                            <span className="staged-color-name">{row.colorName}</span>
                            <span className="muted">
                              {row.sets} set{row.sets === 1 ? '' : 's'} · {REASON_LABELS[row.reason] ?? row.reason}
                            </span>
                            <button
                              type="button"
                              className="link-button danger-text"
                              onClick={() => handleRemoveLine(row.entryId, row.colorId)}
                              aria-label={`Remove ${row.colorName}`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {submitError && (
        <p className="error-banner" role="alert">
          Could not log this return: {submitError}
        </p>
      )}

      {totalLineCount > 0 && (
        <div className="sticky-action-bar">
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Logging…' : `Log return (${totalLineCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
