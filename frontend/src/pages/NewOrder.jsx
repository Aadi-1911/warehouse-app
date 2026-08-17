import { useEffect, useState } from 'react';
import { ShoppingBagIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listParties } from '../api/parties';
import { listFactories } from '../api/factories';
import { listProducts, getValidColors } from '../api/products';
import { listStock } from '../api/stock';
import { createOrder } from '../api/orders';

// New Order — 07_UI_DESIGN_BRIEF.md §5.3 / §6 Round 6 refinements / §7 Round 7 refinements /
// 05_BUSINESS_RULES.md rules 21-26, 53-56. "Review order" now genuinely submits via
// POST /api/orders (previously staging-and-preview only).
//
// Rule 25: staff creating orders during a sample visit is the PRIMARY real-world use case here,
// not an owner action — this screen is reachable by any authenticated role (App.jsx has no
// requireRole on this route), same reasoning already applied to Order's own API endpoints.

// Rule 50's fixed Kids piece counts — same lookup ReceiveStock.jsx uses, kept local here too
// since it's a tiny fixed table tied to one business rule, not shared app state.
const KIDS_PIECES_BY_LABEL = { '1-5yr': 5, '6-16yr': 6, '12-18yr': 4 };

// Rule 56: ≤2 sets = a red flag/badge, unified across Live Stock, Pack Order, AND New Order —
// explicitly correcting "earlier looser/inconsistent thresholds." Matches Live Stock's own
// badge-danger treatment exactly; see LEARNING_LOG.md for why this is red, not amber.
const LOW_STOCK_THRESHOLD = 2;

function piecesPerSetFor(product) {
  return product.isKids
    ? KIDS_PIECES_BY_LABEL[product.sizes[0]?.sizeLabel] ?? 0
    : product.sizes.length;
}

export default function NewOrder() {
  // --- Party picker (07_UI_DESIGN_BRIEF.md §5.3, added 2026-08-15): filter chips (All / one
  // per location in use / Other) above a list grouped by location, alphabetical within each
  // group, "Other" catching parties with no location, "All" selected by default.
  const [parties, setParties] = useState([]);
  const [partiesStatus, setPartiesStatus] = useState('idle');
  const [partiesError, setPartiesError] = useState(null);
  const [partyChipFilter, setPartyChipFilter] = useState('ALL');
  const [selectedPartyId, setSelectedPartyId] = useState('');
  // Open until a party is picked, then collapses to a compact "chosen" row with a Change link —
  // same UX shape as Receive Stock's article-lookup-then-Change pattern.
  const [partyPickerOpen, setPartyPickerOpen] = useState(true);

  // Only needed to resolve a factoryId into a display name for the disambiguation chips below —
  // GET /api/products doesn't join Factory (see productSelect, productController.js).
  const [factories, setFactories] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setPartiesStatus('loading');
    Promise.all([listParties(), listFactories()])
      .then(([partyList, factoryList]) => {
        if (cancelled) return;
        setParties(partyList);
        setFactories(factoryList);
      })
      .catch((err) => {
        if (cancelled) return;
        setPartiesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPartiesStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeParties = parties.filter((p) => p.isActive);
  // Distinct locations actually in use, alphabetical — this IS the chip row (plus "All" and a
  // trailing "Other" for parties with no location, both fixed, not derived from data).
  const partyLocations = [...new Set(activeParties.filter((p) => p.location).map((p) => p.location))].sort(
    (a, b) => a.localeCompare(b)
  );

  // Grouped by location, alphabetical within each group, trailing "Other" group for parties
  // with no location — narrowed to just the chip-selected group (or Other) when one is picked.
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

  // --- Article search: unlike Receive Stock (where Factory is a session-level dropdown chosen
  // BEFORE any lookup, so a search is always already scoped to one factory), New Order has no
  // such session-level Factory field — a search can genuinely match more than one Factory, which
  // is exactly what rule 54's disambiguation chips exist for. Nothing in Receive Stock actually
  // implements this (checked directly, see LEARNING_LOG.md); built fresh here.
  const [articleNo, setArticleNo] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // Non-null only when the search matched more than one Factory — one chip per match.
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
      // Deliberately NOT scoped by factoryId (no such field exists on this screen) — searches
      // across every Factory, then narrows to real exact matches. The backend's own articleNo
      // filter is a case-insensitive *contains* match (productController.js), so "A1" would
      // also return "A10" — exact-matching client-side here is the same discipline
      // findExactMatch already applies in Receive Stock, just without a factory scope.
      const results = await listProducts({ articleNo: trimmed });
      // Archived articles are hidden from daily pickers (rule 85) — an order shouldn't be
      // placeable against one, same convention as every other archivable entity's default view.
      const exact = results.filter(
        (p) => p.articleNo.toLowerCase() === trimmed.toLowerCase() && p.isActive
      );

      if (exact.length === 0) {
        setSearchError(`No active article found with number "${trimmed}".`);
      } else if (exact.length === 1) {
        setResolvedProduct(exact[0]);
      } else {
        // Article numbers are only unique per Factory, never globally (rule 54) — more than
        // one exact match means the same number exists under different Factories for real.
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
    setStockByBundleId({});
    setStockStatus('idle');
    setStockError(null);
    setCheckedColors({});
  }

  // --- Once resolved: valid colors (Critical Interaction Rule #5 — never show a color an
  // article doesn't have) plus a live stock read purely to compute each color's low-stock badge
  // (rule 56) — never the exact number (07_UI_DESIGN_BRIEF.md §5.3: "never show exact stock
  // numbers here"), and never used to block adding — ordering more than what's in stock is
  // allowed, packing later handles any shortfall (rule 64, a separate concern from this screen).
  const [colors, setColors] = useState([]);
  const [colorsStatus, setColorsStatus] = useState('idle');
  const [colorsError, setColorsError] = useState(null);
  const [stockByBundleId, setStockByBundleId] = useState({});
  const [stockStatus, setStockStatus] = useState('idle');
  const [stockError, setStockError] = useState(null);
  // { [colorId]: { sets: number } } — present only for CHECKED colors, which is what reveals
  // that color's own inline stepper. Unchecking drops the entry and its in-progress quantity.
  const [checkedColors, setCheckedColors] = useState({});

  useEffect(() => {
    if (!resolvedProduct) {
      setColorsStatus('idle');
      setStockStatus('idle');
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

    setStockStatus('loading');
    setStockError(null);
    listStock({ articleNo: resolvedProduct.articleNo })
      .then((rows) => {
        if (cancelled) return;
        // articleNo is a contains-match server-side, not scoped to this Product's Factory —
        // filtering to the exact productId is what makes this safe (same reasoning as the
        // article search's own exact-match filter above).
        const totals = {};
        rows
          .filter((r) => r.productId === resolvedProduct.id)
          .forEach((r) => {
            totals[r.bundleId] = (totals[r.bundleId] ?? 0) + r.qtySets;
          });
        setStockByBundleId(totals);
      })
      .catch((err) => {
        if (!cancelled) setStockError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStockStatus('loaded');
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

  // --- Order summary: entries grouped by article, one entry per "Add selected" action (an
  // article searched and committed twice in a session produces two entries, merged for display
  // by productId below — same convention Receive Stock's own groupedReceipt uses).
  const [orderLines, setOrderLines] = useState([]);
  const [nextLineId, setNextLineId] = useState(0);

  const canAddSelected = Object.values(checkedColors).some((c) => c.sets > 0);

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

    const entry = {
      id: nextLineId,
      productId: resolvedProduct.id,
      articleNo: resolvedProduct.articleNo,
      productName: resolvedProduct.name,
      piecesPerSet: piecesPerSetFor(resolvedProduct),
      colors: colorsToAdd,
    };
    setNextLineId((n) => n + 1);
    setOrderLines((prev) => [...prev, entry]);
    resetArticleSearch();
  }

  // Removes ONE colour/quantity line, not the whole article group — different from Receive
  // Stock's handleRemoveGroup (whole-group only), per this task's own spec ("each line
  // removable"). An entry left with zero colours after this is dropped entirely, so an empty
  // group never renders.
  function handleRemoveLine(entryId, colorId) {
    setOrderLines((prev) =>
      prev
        .map((e) => (e.id === entryId ? { ...e, colors: e.colors.filter((c) => c.colorId !== colorId) } : e))
        .filter((e) => e.colors.length > 0)
    );
  }

  const groupedOrderLines = orderLines.reduce((groups, entry) => {
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
      });
    });
    return groups;
  }, []);

  const totalLineCount = orderLines.reduce((sum, e) => sum + e.colors.length, 0);

  // --- Review + submit. The review modal shows the human-readable summary (party, articles,
  // colors, quantities) and, on confirm, actually calls POST /api/orders with this payload.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Scoped to the review modal only — a failed submit keeps the modal open with this message
  // so staff can retry or back out, never a page-level error that could get missed.
  const [submitError, setSubmitError] = useState(null);
  // Set only after a successful submit AND the full screen reset below — shown as a dismissible
  // banner on the now-fresh screen, same "OK to dismiss whenever you're ready" pattern
  // ReceiveStock's own saveOutcome banner already uses, not an auto-vanishing toast.
  const [placedOutcome, setPlacedOutcome] = useState(null);
  const reviewPayload = {
    partyId: selectedPartyId,
    lineItems: orderLines.flatMap((e) => e.colors.map((c) => ({ bundleId: c.bundleId, qtySetsRequested: c.sets }))),
  };

  function handleOpenReview() {
    setSubmitError(null);
    setReviewOpen(true);
  }

  // Everything staged gets wiped so the screen is genuinely ready for the next order — staff
  // place several back-to-back during one sales visit (rule 25), so this must not force a
  // navigation away from the screen.
  function resetOrderScreen() {
    setSelectedPartyId('');
    setPartyPickerOpen(true);
    setPartyChipFilter('ALL');
    resetArticleSearch();
    setOrderLines([]);
  }

  async function handleConfirmOrder() {
    setSubmitError(null);
    setSubmitting(true);
    // Captured now, before resetOrderScreen below clears the state these read from — closure
    // values here are frozen at call time, but reading them straight from state AFTER the reset
    // would just read the now-emptied values.
    const partyName = selectedParty?.name ?? '';
    const lineCount = totalLineCount;
    try {
      const created = await createOrder(reviewPayload);
      setReviewOpen(false);
      resetOrderScreen();
      setPlacedOutcome({ partyName, lineCount, orderId: created.id });
    } catch (err) {
      // Deliberately NOT resetting anything here — a Party archived or a price unset between
      // staging and submitting (realistic: another session made the change) must never cost
      // staff their staged work. They fix the underlying issue or back out to edit, then retry.
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <ScreenHeader icon={<ShoppingBagIcon size={20} />} tone="purple" title="New Order" />
      {selectedParty && <p className="muted">{selectedParty.name}</p>}

      {placedOutcome && (
        <div className="result-banner result-banner-success">
          <p>
            <strong>Order placed for {placedOutcome.partyName}.</strong> {placedOutcome.lineCount} line
            {placedOutcome.lineCount === 1 ? '' : 's'} — order #{placedOutcome.orderId.slice(-6)}.
          </p>
          <button type="button" className="link-button" onClick={() => setPlacedOutcome(null)}>
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

      {selectedPartyId && (
        <div className="card">
          <h2 className="card-title">Add article</h2>

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

          {/* Rule 54: more than one Factory has this exact article number — one chip per match,
              labeled with both article name and Factory (§7's copy convention), since the
              article name is often the fastest way to recognize which one is meant. */}
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
              {stockError && (
                <p className="error-banner" role="alert">
                  Could not check stock: {stockError}
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
                    const totalStock = stockByBundleId[c.bundleId] ?? 0;
                    const low = stockStatus === 'loaded' && totalStock <= LOW_STOCK_THRESHOLD;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`chip ${checked ? 'chip-selected' : ''}`}
                        onClick={() => toggleColorChip(c.id)}
                        aria-pressed={checked}
                      >
                        {c.name}
                        {low && <span className="badge badge-danger color-chip-low-badge">Low stock</span>}
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
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleAddSelected}
                  disabled={!canAddSelected}
                >
                  Add selected
                </button>
              )}
            </>
          )}
        </div>
      )}

      {groupedOrderLines.length > 0 && (
        <>
          <h2 className="section-heading">Order Summary</h2>
          {groupedOrderLines.map((group) => (
            <div key={group.productId} className="card receipt-group">
              <div className="receipt-group-header">
                <div>
                  <span className="receipt-group-article">{group.articleNo}</span>
                  <span className="muted"> — {group.productName}</span>
                </div>
              </div>
              <div className="staged-list">
                {group.rows.map((row) => (
                  <div key={`${row.entryId}-${row.colorId}`} className="staged-row">
                    <span className="staged-color-name">{row.colorName}</span>
                    <span className="muted">
                      {row.sets} set{row.sets === 1 ? '' : 's'} · {row.pieces} pc
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
          ))}
        </>
      )}

      {totalLineCount > 0 && (
        <div className="sticky-action-bar">
          <button type="button" className="btn-primary" onClick={handleOpenReview}>
            Review order ({totalLineCount})
          </button>
        </div>
      )}

      {/* Custom shell, not the ConfirmModal component — its body prop is text-only, and this
          needs to show real structured content (grouped lines), plus an in-flight/error state
          around the actual POST /api/orders call. Clicking the scrim is deliberately NOT wired
          to close/cancel here (unlike other modals) — a mid-submit accidental tap must never
          silently discard a real order attempt; "Back to edit" is the one explicit way out. */}
      {reviewOpen && (
        <div className="modal-scrim">
          <div className="modal-card">
            <h2 className="modal-title">Review Order</h2>
            <p className="modal-body">
              <strong>{selectedParty?.name}</strong> — {totalLineCount} line{totalLineCount === 1 ? '' : 's'}
            </p>
            {groupedOrderLines.map((group) => (
              <div key={group.productId}>
                <p className="modal-body">
                  <strong>{group.articleNo}</strong> — {group.productName}
                </p>
                {group.rows.map((row) => (
                  <p key={`${row.entryId}-${row.colorId}`} className="modal-body muted">
                    {row.colorName} — {row.sets} set{row.sets === 1 ? '' : 's'} ({row.pieces} pc)
                  </p>
                ))}
              </div>
            ))}

            {submitError && (
              <p className="error-banner" role="alert">
                Could not place this order: {submitError}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setReviewOpen(false)}
                disabled={submitting}
              >
                Back to edit
              </button>
              <button
                type="button"
                className="btn-modal-confirm btn-modal-confirm-accent"
                onClick={handleConfirmOrder}
                disabled={submitting}
              >
                {submitting ? 'Placing order…' : 'Confirm and place order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
