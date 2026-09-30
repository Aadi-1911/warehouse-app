import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { KeyIcon, ChevronIcon } from '../../components/icons';
import { listFactories } from '../../api/factories';
import { listLocations } from '../../api/locations';
import { listProducts, updateProduct, setLocationPricingEnabled, setLocationPrice } from '../../api/products';
import PinPrompt from '../../components/PinPrompt';
import { computeMargin } from '../../utils/margin';
// T1 (2026-09-30): was a local formatCurrency(), byte-identical to the one pages/ArticlePricing.jsx
// had of its own — now utils/money.js's shared formatMoney(), used directly at every call site
// below (cost/selling price, and as computeMargin's own formatter argument). Every figure on this
// screen is a price (cost/selling/margin), never one of BillOrderDetail's discount/GST/Order-total
// lines, so this always uses formatMoney's default 'price' mode — see money.js's own header
// comment for what that mode means.
import { formatMoney } from '../../utils/money';

// Owner Dashboard — Article Pricing (added 2026-08-21, beyond 07_UI_DESIGN_BRIEF.md §8's
// original 5-item nav — same "append sensibly, don't renumber the existing list" precedent
// Locations already established).
//
// A genuine desktop grid, not the mobile screen ported over: mobile (pages/ArticlePricing.jsx)
// is factory-scoped (pick a Factory first, then see its articles) because on a phone that's the
// only way to keep the list short enough to be usable. This fetches unfiltered (GET /api/products
// with no factoryId) rather than forcing a picker — a desktop owner can see every factory at once.
//
// Restructured 2026-08-26 into Factory-grouped accordion sections, matching Low Stock/Live
// Stock/Transfer's shared Factory→Article convention. Before this, Factory was a plain sortable
// COLUMN in one flat table, and clicking any column header (Article No/Name/Factory/Cost/
// Selling/Margin, either direction) could resort the whole list. That free-column-sort is gone
// now, on purpose: no other Factory-grouped screen in this app combines grouping with per-column
// sort, and "group by Factory, ascending article number within each group" (with pending
// articles first within their own group) is a complete, fixed ordering on its own — the same
// fixed-order convention Low Stock/Live Stock/Transfer already use with no sort controls at all.
//
// Mobile needed NO equivalent restructuring — its own Factory <select> already scopes every
// fetch to exactly one factory, so there's no cross-factory list to group in the first place.
// Wrapping an already-single-factory list in its own accordion would cost a click for nothing,
// the same "no wrapper for a single item" call already made for Transfer's single-colour
// articles and Live Stock's single-location articles.
//
// Reuses the exact same backend surface mobile does, on purpose — no parallel price-write path:
// GET /api/products (role-aware; costPrice is only ever selected server-side for OWNER, see
// productController.js's productSelect) and PATCH /api/products/:id (OWNER + PIN the moment
// costPrice/sellingPrice appear in the body, requirePinForPriceEdits in routes/products.js).
//
// Pending articles (rule 8 — created via Receive Stock's "New article" branch with no price yet)
// are INCLUDED, not filtered out — confirmed by reading mobile's own isPending()/sort-pending-
// first logic before assuming either way. This page is specifically an owner pricing-management
// tool; a pending article is exactly the kind of row it exists to surface, not noise to hide.
//
// PIN flow uses PinPrompt directly, NOT mobile's hand-copied inline PIN field — mobile is one of
// the three known not-yet-refactored copies (PinPrompt's own header comment), and that refactor
// is deliberately deferred. But this is new code, so it gets PinPrompt from day one rather than
// becoming a fourth copy. PinPrompt owns its own <form> and can't be merged into a bigger one, so
// editing here is a real two-step reveal per row — cost/selling price inputs first, PinPrompt
// only once those are valid — the same "stage the fields, then swap to PinPrompt" shape the
// dashboard's Parties page (Record Payment) and History page (price corrections) already use,
// adapted to a single table row instead of a card.
//
// Only one row can be mid-edit at a time (editingId is a single value, not a Set) — and unlike
// mobile, starting an edit on a DIFFERENT row while one is already open is disabled outright,
// not silently allowed to abandon the first. Mobile's single-step form has nothing granular to
// lose by switching (one combined form, overwritten wholesale); this page's two-step form can be
// sitting at the PIN step with a staged price when another row's Edit is clicked, and silently
// discarding a PIN-step-in-progress edit is worse than a mobile user losing an untouched field —
// worth the small deliberate tightening here.
//
// This dashboard PIN is real and separate from the dashboard's own lock screen (rule 71 vs. the
// lock's privacy-only role) — see DashboardLayout.jsx's own PIN LOCK note. The lock hides the
// screen from a shoulder-surfer; nothing about it substitutes for the price-edit PIN gate, which
// still runs on every single edit here exactly as it does on mobile.
//
// Rename (added here 2026-09-01, reusing mobile's ArticlePricing.jsx rename feature from
// 3ab28d1 exactly at the API layer) — same PATCH /api/products/:id, same { name } body, same
// updateProduct() client function, no new endpoint. No PIN, on purpose, matching mobile: rule
// 71's PIN gate is specifically about money, and `name` sits with categoryId/isKids as an
// ordinary OWNER-only attribute edit (routes/products.js's requirePinForPriceEdits only inspects
// the body for costPrice/sellingPrice, so a name-only PATCH never triggers it). OWNER enforcement
// itself is NOT something this page adds or could bypass even if it wanted to — it's already
// double-covered independently of anything here: the /dashboard route tree's own requireRole
// gate (App.jsx) keeps a STAFF session off this screen entirely, and routes/products.js's
// requireRole('OWNER') on the PATCH route runs server-side unconditionally regardless of what any
// client sends. Reusing the exact same endpoint/client function the price form already calls
// means rename inherits both of those for free — there is no separate write path to gate.
//
// UI shape adapted to THIS page's existing row-based editing convention rather than mobile's
// separate card-below-the-table form: mobile has no per-row inline state to conflict with (one
// flat form, one row at a time by construction), but this page already enforces "only one row
// mid-edit at once" for price edits, so rename gets its own equally-exclusive per-row state
// (renamingId) rather than a second, independent form that could be open at the same time as a
// price edit on a different row.

function isPending(product) {
  return product.costPrice == null || product.sellingPrice == null;
}

// The location override's own validation (rule 111 — F3, 2026-09-29): a real number strictly
// greater than 0, with AT MOST 2 decimal places. Checked on the raw STRING before Number() ever
// runs — Number("12.345") is a perfectly finite, valid number, so checking decimal count on the
// parsed value can't catch it; the regex has to see the original text. This mirrors, but does not
// call, the server's own check in setLocationPrice (productController.js) — which now ALSO
// enforces this same 2-decimal cap server-side (by reusing rule 113's validatePriceValue), so this
// client-side check is a UX convenience that rejects early, not the only enforcement of the rule.
function parseLocationSellingPrice(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { error: 'Enter a selling price.' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { error: 'Enter a price greater than 0, with at most 2 decimal places.' };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: 'Enter a price greater than 0, with at most 2 decimal places.' };
  }
  return { parsed };
}

// Fixed table shape for every factory group's own table — Factory itself is deliberately absent
// from this list now: it's stated once in the enclosing accordion header, the same "state it once
// in the group header, drop it from every row inside" convention Live Stock's own locationGroups
// already established. 5 data columns + 1 action column, referenced below wherever an extra row
// (the inline error banner, the PIN-confirm step) needs to span the full table width.
const TABLE_COLUMN_COUNT = 6;

export default function DashboardArticlePricing() {
  const { user } = useAuth();

  const [factories, setFactories] = useState([]);
  const [products, setProducts] = useState([]);
  // Rule 111 (F3) — every ACTIVE location, for the per-location pricing rows. Fetched once
  // alongside factories/products, same "one mount fetch, no per-row re-fetch" shape this screen
  // already uses. Archived locations are excluded (rule 85's "hidden from daily pickers by
  // default" convention) — an archived location can still HOLD a saved LocationPrice row (the
  // backend's own PUT deliberately allows editing one, per rule 111's comment on
  // setLocationPrice), but this screen has no reason to offer a NEW row for a location nobody
  // picks from day to day.
  const [locations, setLocations] = useState([]);
  // 'idle' | 'loading' | 'loaded' — never a bare boolean, same discipline as every other
  // mount-fetching screen in this app.
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState(null);

  // Factory-level accordion state — a Set of factoryIds, same shape and same "collapsed by
  // default" convention Live Stock/Low Stock/Transfer already use for their own Factory layer.
  const [expandedFactories, setExpandedFactories] = useState(() => new Set());

  // Which row (if any) is mid-edit — a single id, not a Set, since only one edit is ever open.
  const [editingId, setEditingId] = useState(null);
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [formError, setFormError] = useState(null);
  // Staged { costPrice, sellingPrice } once step 1 is validated — presence is what swaps the
  // row over to PinPrompt, same "draft object as the step gate" shape Parties.jsx's
  // paymentDraft and History.jsx's correction drafts already use.
  const [priceDraft, setPriceDraft] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Rename state — deliberately separate from editingId/priceDraft above (see the file header
  // comment for why merging the two forms would be wrong, not just messier).
  const [renamingId, setRenamingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);

  // --- Rule 111 (F3) — per-location pricing state, deliberately its own three blocks below,
  // none merged with the price-edit or rename state above (same "don't let two different forms
  // fight over one piece of state" reasoning this file already gives for keeping rename separate
  // from price edits).

  // The toggle itself — OWNER-only, no PIN (rule 111). `toggleInFlightId` names the ONE product
  // currently mid-request, so its checkbox (and only its checkbox) can show a disabled/"working"
  // state; `toggleError` is scoped to a specific product (not a bare string) so a failure on one
  // article's toggle can't get misread as belonging to a different article's row.
  const [toggleInFlightId, setToggleInFlightId] = useState(null);
  const [toggleError, setToggleError] = useState(null); // { productId, message } | null

  // Which location row (if any) is mid-edit, across ALL products/locations on the page — a
  // single { productId, locationId }, not a Set, extending the same "only one row mid-edit at a
  // time" discipline editingId/renamingId already enforce to this new third kind of row.
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationPriceInput, setLocationPriceInput] = useState('');
  const [locationFormError, setLocationFormError] = useState(null);
  // Staged { productId, locationId, sellingPrice } once step 1 is validated (sellingPrice is
  // `null` for "Use base price") — presence is what swaps THIS location row over to PinPrompt,
  // the same draft-object-as-step-gate shape priceDraft above already uses.
  const [locationDraft, setLocationDraft] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    Promise.all([listFactories(), listProducts(), listLocations()])
      .then(([factoryList, productList, locationList]) => {
        if (cancelled) return;
        setFactories(factoryList);
        setProducts(productList);
        // Active only (see the state's own comment above), sorted alphabetically — matches the
        // order the backend already returns `locationPrices` in (productSelect's own
        // `orderBy: { location: { name: 'asc' } }`), so a location's row here and its row inside
        // any given article's `locationPrices` array can never disagree about ordering.
        setLocations(locationList.filter((l) => l.isActive).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFactory(factoryId) {
    setExpandedFactories((prev) => {
      const next = new Set(prev);
      if (next.has(factoryId)) next.delete(factoryId);
      else next.add(factoryId);
      return next;
    });
  }

  function handleStartEdit(product) {
    setEditingId(product.id);
    // Pre-filled with the row's current prices — null (pending) becomes an empty field to type
    // into, never "0", which would read as a real zero price if left untouched.
    setCostPrice(product.costPrice != null ? String(product.costPrice) : '');
    setSellingPrice(product.sellingPrice != null ? String(product.sellingPrice) : '');
    setFormError(null);
    setPriceDraft(null);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setCostPrice('');
    setSellingPrice('');
    setFormError(null);
    setPriceDraft(null);
  }

  // Step 1 -> step 2: validate, then stage — this is what reveals PinPrompt.
  function handleContinueToPin() {
    setFormError(null);
    const parsedCost = Number(costPrice);
    const parsedSelling = Number(sellingPrice);
    if (!costPrice || !Number.isFinite(parsedCost) || parsedCost <= 0) {
      setFormError('Enter a valid cost price.');
      return;
    }
    if (!sellingPrice || !Number.isFinite(parsedSelling) || parsedSelling <= 0) {
      setFormError('Enter a valid selling price.');
      return;
    }
    setPriceDraft({ costPrice: parsedCost, sellingPrice: parsedSelling });
  }

  function handleEnterKeyContinue(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleContinueToPin();
    }
  }

  // Step 2: PinPrompt calls this with just the pin — throws on failure, which PinPrompt's own
  // error/lockout rendering catches (see that component for why nothing is duplicated here).
  async function handleConfirmEdit(pin) {
    const editedProduct = products.find((p) => p.id === editingId);
    await updateProduct(editingId, { ...priceDraft, pin });
    setSuccessMessage(`${editedProduct.articleNo} — ${editedProduct.name} updated.`);
    handleCancelEdit();
    // Re-fetch so the table reflects the edit just made, never patched optimistically — same
    // discipline every other mutation in this app follows.
    setStatus('loading');
    const fresh = await listProducts();
    setProducts(fresh);
    setStatus('loaded');
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  function handleStartRename(product) {
    setRenamingId(product.id);
    // Pre-filled with the CURRENT name, not blank — same reasoning mobile's own
    // handleStartRename gives: a rename is almost always a small correction to an existing name,
    // not a fresh entry.
    setNewName(product.name);
    setRenameError(null);
  }

  function handleCancelRename() {
    setRenamingId(null);
    setNewName('');
    setRenameError(null);
  }

  async function handleSubmitRename(product) {
    setRenameError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenameError('Enter a name.');
      return;
    }
    // Nothing to save, and the server would reject a no-op PATCH as "no editable fields" anyway
    // — caught here for a plain-language reason instead of a validation error, same as mobile.
    if (trimmed === product.name) {
      setRenameError('That is already the current name.');
      return;
    }

    setRenameSubmitting(true);
    try {
      // No `pin` in this body, on purpose — see the file header comment.
      await updateProduct(product.id, { name: trimmed });
      setSuccessMessage(
        `${product.articleNo} renamed to "${trimmed}". Orders, transfers and returns recorded before now keep showing the old name.`
      );
      handleCancelRename();
      // Re-fetch so the table shows the new name rather than the one just replaced — never
      // patched optimistically, same discipline every other mutation on this page follows.
      setStatus('loading');
      const fresh = await listProducts();
      setProducts(fresh);
      setStatus('loaded');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setRenameError(err.message);
    } finally {
      setRenameSubmitting(false);
    }
  }

  function handleRenameEnterKey(event, product) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSubmitRename(product);
    }
  }

  // The toggle — PATCH /api/products/:id/location-pricing, no PIN (rule 111). Fires immediately
  // on the checkbox's own onChange rather than needing a separate confirm step: unlike the price
  // edits below, this writes no money (see setLocationPricingEnabled's own comment in
  // api/products.js), so there is nothing here for a PIN — or a second click — to protect.
  async function handleToggleLocationPricing(product, enabled) {
    setToggleError(null);
    setToggleInFlightId(product.id);
    try {
      await setLocationPricingEnabled(product.id, enabled);
      // Re-fetch so the row's locationPrices/hasLocationPricing reflect the real saved state,
      // never patched optimistically — same discipline every other mutation on this page follows.
      setStatus('loading');
      const fresh = await listProducts();
      setProducts(fresh);
      setStatus('loaded');
    } catch (err) {
      setToggleError({ productId: product.id, message: err.message });
    } finally {
      setToggleInFlightId(null);
    }
  }

  // Step 1 open — pre-filled with the row's CURRENT EFFECTIVE price (its own override if it has
  // one, else the article's base price), same "pre-fill with what's already true" reasoning
  // handleStartEdit above already uses for cost/selling. `effectivePrice` is passed in by the
  // caller rather than recomputed here because the row already had to compute it once to render
  // itself — see the JSX below.
  function handleStartLocationEdit(product, locationId, effectivePrice) {
    setEditingLocation({ productId: product.id, locationId });
    setLocationPriceInput(effectivePrice != null ? String(effectivePrice) : '');
    setLocationFormError(null);
    setLocationDraft(null);
  }

  function handleCancelLocationEdit() {
    setEditingLocation(null);
    setLocationPriceInput('');
    setLocationFormError(null);
    setLocationDraft(null);
  }

  // Step 1 -> step 2 (typed value branch): validate, then stage — this is what reveals PinPrompt
  // for this location row. Mirrors handleContinueToPin above.
  function handleContinueLocationEdit() {
    setLocationFormError(null);
    const { parsed, error } = parseLocationSellingPrice(locationPriceInput);
    if (error) {
      setLocationFormError(error);
      return;
    }
    setLocationDraft({ ...editingLocation, sellingPrice: parsed });
  }

  // Step 1 -> step 2 (the OTHER branch): "Use base price" stages `sellingPrice: null` directly,
  // with no typed value required — clearing an override is a real, deliberate action in its own
  // right (rule 111), not just "leave the field blank and hit Save".
  function handleUseBaseLocationPrice() {
    setLocationFormError(null);
    setLocationDraft({ ...editingLocation, sellingPrice: null });
  }

  function handleLocationEnterKeyContinue(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleContinueLocationEdit();
    }
  }

  // Step 2: PinPrompt calls this with just the pin — throws on failure, which PinPrompt's own
  // error/lockout rendering catches (see PinPrompt.jsx and handleConfirmEdit above for why
  // nothing is duplicated here). NEVER sends costPrice — the body is exactly
  // { sellingPrice, pin }, built by setLocationPrice (api/products.js).
  async function handleConfirmLocationEdit(pin) {
    const { productId, locationId, sellingPrice } = locationDraft;
    const product = products.find((p) => p.id === productId);
    const location = locations.find((l) => l.id === locationId);
    await setLocationPrice(productId, locationId, { sellingPrice, pin });
    setSuccessMessage(
      sellingPrice === null
        ? `${product.articleNo} — ${location.name} now bills at the base price again.`
        : `${product.articleNo} — ${location.name} price updated.`
    );
    handleCancelLocationEdit();
    // Re-fetch so the table reflects the edit just made, never patched optimistically.
    setStatus('loading');
    const fresh = await listProducts();
    setProducts(fresh);
    setStatus('loaded');
    setTimeout(() => setSuccessMessage(null), 3000);
  }

  const factoryNameById = new Map(factories.map((f) => [f.id, f.name]));

  // Active articles only — archive/reactivate is a separate concern this page doesn't manage
  // (mobile's own archive toggle isn't part of what was asked for here).
  const visibleProducts = products.filter((p) => p.isActive);

  // Factory -> Article groups (rule matching Low Stock/Live Stock/Transfer's shared convention).
  // productId isn't the grouping concern here the way it is on those screens (each Article IS
  // the row, not a further-nested group), so this only needs one level: bucket by factoryId,
  // then sort the bucket's own articles.
  const factoryGroups = new Map();
  visibleProducts.forEach((product) => {
    const factoryId = product.factoryId;
    if (!factoryGroups.has(factoryId)) {
      factoryGroups.set(factoryId, {
        factoryId,
        factoryName: factoryNameById.get(factoryId) ?? 'Unknown Factory',
        products: [],
      });
    }
    factoryGroups.get(factoryId).products.push(product);
  });

  const groupedFactories = [...factoryGroups.values()]
    .map((group) => {
      // Pending-first, then ascending articleNo — WITHIN this one factory's own group, not the
      // top of the whole table. A global pending-first sort would scatter attention away from
      // each factory's own coherent article list, which directly fights the reason grouping
      // exists in the first place; this keeps pending articles exactly as discoverable as
      // before; just scoped to where an owner is already looking. Same tie-break mobile's own
      // sortedProducts already uses, so the two screens can never disagree on ordering.
      const sortedProducts = [...group.products].sort((a, b) => {
        const aPending = isPending(a);
        const bPending = isPending(b);
        if (aPending !== bPending) return aPending ? -1 : 1;
        return a.articleNo.localeCompare(b.articleNo);
      });
      return {
        ...group,
        products: sortedProducts,
        // Feeds the collapsed header's summary badge — surfaces pending articles WITHOUT
        // forcing every factory open, the same "useful info on the collapsed header" convention
        // Live Stock's own low-count badge already establishes for its factory layer. Without
        // this, collapsing factories by default (§3.2's own convention) would quietly regress
        // this screen's whole reason for existing (rule 8/71 — surfacing stuck-pending articles)
        // behind an extra click per factory.
        pendingCount: sortedProducts.filter(isPending).length,
      };
    })
    .sort((a, b) => a.factoryName.localeCompare(b.factoryName));

  if (status !== 'loaded') {
    return (
      <>
        {loadError && (
          <p className="error-banner" role="alert">
            Could not load articles: {loadError}
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
          Could not refresh articles: {loadError}
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

      {!user.hasPinSet && (
        <Link to="/set-pin" className="prompt-banner prompt-banner-warning">
          <KeyIcon size={18} />
          <span>Set your price-edit PIN to edit article prices.</span>
        </Link>
      )}

      {groupedFactories.length === 0 ? (
        <p className="muted dash-empty">No active articles yet.</p>
      ) : (
        groupedFactories.map((group) => {
          const factoryOpen = expandedFactories.has(group.factoryId);
          return (
            <div key={group.factoryId} className="card accordion-section">
              <button
                type="button"
                className="accordion-header"
                onClick={() => toggleFactory(group.factoryId)}
                aria-expanded={factoryOpen}
              >
                <div className="accordion-header-text">
                  <div className="accordion-title">{group.factoryName}</div>
                  <div className="muted accordion-subtitle">
                    {group.products.length} article{group.products.length === 1 ? '' : 's'}
                    {group.pendingCount > 0 && (
                      <span className="badge badge-warning accordion-low-badge">
                        {group.pendingCount} pending
                      </span>
                    )}
                  </div>
                </div>
                <ChevronIcon className={factoryOpen ? 'chevron chevron-open' : 'chevron'} />
              </button>

              {factoryOpen && (
                <div className="accordion-body">
                  <div className="table-scroll">
                    <table className="dash-pricing-table">
                      <thead>
                        <tr>
                          <th>Article No</th>
                          <th>Name</th>
                          <th className="dash-pricing-num">Cost Price</th>
                          <th className="dash-pricing-num">Selling Price</th>
                          <th className="dash-pricing-num">Margin</th>
                          <th className="dash-pricing-action">
                            <span className="visually-hidden">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.products.map((product, rowIndex) => {
                          const pending = isPending(product);
                          const isEditing = editingId === product.id;
                          const isStaged = isEditing && !!priceDraft;
                          const isRenaming = renamingId === product.id;

                          // Rule 111 (F3) — is THIS product's location-pricing sub-table
                          // currently the one with a row mid-edit (step 1 open, or step 2 staged
                          // with PinPrompt showing)? Read from the single page-wide
                          // editingLocation/locationDraft, whichever is set — they're never both
                          // set to different rows at once (locationDraft is only ever built from
                          // the current editingLocation).
                          const activeLocationEdit = editingLocation ?? locationDraft;
                          const thisProductLocationBusy = activeLocationEdit?.productId === product.id;
                          const anyLocationEditBusy = activeLocationEdit !== null;

                          // Only one row total may be mid-edit, mid-rename, OR mid-location-edit
                          // at once, across the WHOLE page — the same single-active-edit
                          // discipline this page already enforces for price edits and rename,
                          // extended to cover the new per-location rows as a third exclusive mode.
                          // A location edit busies every OTHER product's row (including this
                          // product's own Edit/Rename, via thisProductLocationBusy below) exactly
                          // the way editingId/renamingId already busy every row but their own.
                          const anyOtherRowBusy =
                            (editingId !== null && editingId !== product.id) ||
                            (renamingId !== null && renamingId !== product.id) ||
                            (anyLocationEditBusy && !thisProductLocationBusy);

                          return (
                            <Fragment key={product.id}>
                              {/* Alternating stripe keyed to `rowIndex` (this product's own
                                  position in group.products), NOT :nth-child — the conditionally-
                                  inserted error/PIN rows below would otherwise shift which stripe
                                  colour every later row lands on every time one opens or closes.
                                  See --row-stripe-fill and .dash-pricing-row-alt's own comments in
                                  index.css. isEditing wins when both classes would apply (CSS
                                  cascade order, not string order, decides that — see index.css). */}
                              <tr
                                className={[
                                  isEditing || isRenaming ? 'dash-pricing-row-editing' : '',
                                  rowIndex % 2 === 1 ? 'dash-pricing-row-alt' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <td>{product.articleNo}</td>
                                <td>
                                  {isRenaming ? (
                                    <input
                                      type="text"
                                      className="dash-pricing-name-input"
                                      value={newName}
                                      onChange={(e) => setNewName(e.target.value)}
                                      onKeyDown={(e) => handleRenameEnterKey(e, product)}
                                      autoFocus
                                      disabled={renameSubmitting}
                                    />
                                  ) : (
                                    product.name
                                  )}
                                </td>
                                {isEditing && !isStaged ? (
                                  <>
                                    <td className="dash-pricing-num">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0.01"
                                        step="0.01"
                                        className="dash-pricing-inline-input"
                                        value={costPrice}
                                        onChange={(e) => setCostPrice(e.target.value)}
                                        onKeyDown={handleEnterKeyContinue}
                                        autoFocus
                                      />
                                    </td>
                                    <td className="dash-pricing-num">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0.01"
                                        step="0.01"
                                        className="dash-pricing-inline-input"
                                        value={sellingPrice}
                                        onChange={(e) => setSellingPrice(e.target.value)}
                                        onKeyDown={handleEnterKeyContinue}
                                      />
                                    </td>
                                    <td className="dash-pricing-num muted">—</td>
                                  </>
                                ) : isStaged ? (
                                  <>
                                    <td className="dash-pricing-num">{formatMoney(priceDraft.costPrice)}</td>
                                    <td className="dash-pricing-num">{formatMoney(priceDraft.sellingPrice)}</td>
                                    {/* computeMargin (utils/margin.js) — the ONE shared margin
                                        calculation, used here instead of the plain subtraction
                                        this cell used before rule 111's F3 task, so the base row
                                        and every per-location row below can never disagree about
                                        what "margin" means. */}
                                    {(() => {
                                      const margin = computeMargin(priceDraft.costPrice, priceDraft.sellingPrice, formatMoney);
                                      return (
                                        <td className="dash-pricing-num">
                                          {margin.rupees} · {margin.percent}
                                        </td>
                                      );
                                    })()}
                                  </>
                                ) : pending ? (
                                  <>
                                    <td className="dash-pricing-num">
                                      <span className="badge badge-warning">Pending</span>
                                    </td>
                                    <td className="dash-pricing-num">
                                      <span className="badge badge-warning">Pending</span>
                                    </td>
                                    <td className="dash-pricing-num">
                                      <span className="badge badge-warning">Pending</span>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="dash-pricing-num">{formatMoney(product.costPrice)}</td>
                                    <td className="dash-pricing-num">{formatMoney(product.sellingPrice)}</td>
                                    {/* computeMargin (utils/margin.js) itself Number()s both raw
                                        Prisma Decimal strings ("250.5") before subtracting — see
                                        that file's own comment. Now shows margin % alongside ₹
                                        (rule 111's F3 task), where before this cell showed only
                                        the rupee figure. */}
                                    {(() => {
                                      const margin = computeMargin(product.costPrice, product.sellingPrice, formatMoney);
                                      return (
                                        <td className="dash-pricing-num">
                                          {margin.rupees} · {margin.percent}
                                        </td>
                                      );
                                    })()}
                                  </>
                                )}
                                <td className="dash-pricing-action">
                                  <div className="dash-table-action-row">
                                    {isEditing ? (
                                      isStaged ? null : (
                                        <>
                                          <button type="button" className="link-button" onClick={handleContinueToPin}>
                                            Continue
                                          </button>
                                          <button type="button" className="link-button" onClick={handleCancelEdit}>
                                            Cancel
                                          </button>
                                        </>
                                      )
                                    ) : isRenaming ? (
                                      <>
                                        <button
                                          type="button"
                                          className="link-button"
                                          onClick={() => handleSubmitRename(product)}
                                          disabled={renameSubmitting}
                                        >
                                          {renameSubmitting ? 'Saving…' : 'Save'}
                                        </button>
                                        <button
                                          type="button"
                                          className="link-button"
                                          onClick={handleCancelRename}
                                          disabled={renameSubmitting}
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          type="button"
                                          className="link-button"
                                          onClick={() => handleStartEdit(product)}
                                          disabled={!user.hasPinSet || anyOtherRowBusy || thisProductLocationBusy}
                                        >
                                          Edit
                                        </button>
                                        {/* Deliberately NOT gated on user.hasPinSet, unlike Edit
                                            above — mirrors mobile's own rename button exactly: a
                                            rename needs no PIN, so an owner who has never set one
                                            can still fix a typo in an article's name. */}
                                        <button
                                          type="button"
                                          className="link-button"
                                          onClick={() => handleStartRename(product)}
                                          disabled={anyOtherRowBusy || thisProductLocationBusy}
                                        >
                                          Rename
                                        </button>
                                      </>
                                    )}
                                    {/* Rule 111 (F3) — the per-location pricing toggle. No PIN
                                        (writes no money, see handleToggleLocationPricing's own
                                        comment), so it fires on its own onChange rather than
                                        needing Continue/Cancel like the price-edit form does.
                                        Disabled while ANY row on the page is mid-edit — including
                                        this SAME product's own price/rename form — because
                                        flipping this changes which price the article's own base
                                        row would need to reconcile against a form that's still
                                        open. */}
                                    <label className="dash-pricing-location-toggle">
                                      <input
                                        type="checkbox"
                                        checked={product.hasLocationPricing}
                                        onChange={(e) => handleToggleLocationPricing(product, e.target.checked)}
                                        disabled={
                                          toggleInFlightId !== null ||
                                          editingId !== null ||
                                          renamingId !== null ||
                                          anyLocationEditBusy
                                        }
                                      />
                                      Different price per location
                                    </label>
                                  </div>
                                </td>
                              </tr>
                              {toggleError?.productId === product.id && (
                                <tr className="dash-pricing-error-row">
                                  <td colSpan={TABLE_COLUMN_COUNT}>
                                    <p className="error-banner" role="alert">
                                      {toggleError.message}
                                    </p>
                                  </td>
                                </tr>
                              )}
                              {isEditing && !isStaged && formError && (
                                <tr className="dash-pricing-error-row">
                                  <td colSpan={TABLE_COLUMN_COUNT}>
                                    <p className="error-banner" role="alert">
                                      {formError}
                                    </p>
                                  </td>
                                </tr>
                              )}
                              {isRenaming && (
                                <tr className="dash-pricing-pin-row">
                                  <td colSpan={TABLE_COLUMN_COUNT}>
                                    <p className="muted">
                                      This renames the whole article, including all {product.articleNo}'s
                                      colours. Orders, transfers and returns recorded before now keep
                                      showing the old name — renaming only affects what's created from
                                      here on.
                                    </p>
                                    {renameError && (
                                      <p className="error-banner" role="alert">
                                        {renameError}
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                              {isStaged && (
                                <tr className="dash-pricing-pin-row">
                                  <td colSpan={TABLE_COLUMN_COUNT}>
                                    <p className="muted">
                                      Setting cost {formatMoney(priceDraft.costPrice)} and selling{' '}
                                      {formatMoney(priceDraft.sellingPrice)} for {product.articleNo} — {product.name}.
                                      Enter your PIN to confirm.
                                    </p>
                                    <PinPrompt
                                      submitLabel="Save price"
                                      submittingLabel="Saving…"
                                      autoFocus
                                      onSubmit={handleConfirmEdit}
                                    />
                                    <div className="action-row">
                                      <button type="button" className="link-button" onClick={() => setPriceDraft(null)}>
                                        Change details
                                      </button>
                                      <button type="button" className="link-button" onClick={handleCancelEdit}>
                                        Cancel
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {/* Rule 111 (F3) — per-location pricing rows, one per ACTIVE
                                  location, only while the toggle above is on. A nested table
                                  inside its own full-width <tr>, the same "extra row spans
                                  TABLE_COLUMN_COUNT" shape this file already uses for the
                                  error/rename/PIN rows above — the outer table's own 6-column
                                  shape is untouched. */}
                              {product.hasLocationPricing && (
                                <tr className="dash-pricing-location-row">
                                  <td colSpan={TABLE_COLUMN_COUNT}>
                                    {locations.length === 0 ? (
                                      <p className="muted">No active locations to price against.</p>
                                    ) : (
                                      <table className="dash-location-pricing-table">
                                        <thead>
                                          <tr>
                                            <th>Location</th>
                                            <th className="dash-pricing-num">Cost</th>
                                            <th className="dash-pricing-num">Selling Price</th>
                                            <th className="dash-pricing-num">Margin ₹</th>
                                            <th className="dash-pricing-num">Margin %</th>
                                            <th className="dash-pricing-action">
                                              <span className="visually-hidden">Actions</span>
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {locations.map((location) => {
                                            // The row's own override, if any — a row can exist
                                            // with sellingPrice explicitly null (a CLEARED
                                            // override) as well as simply not existing yet;
                                            // rule 111 treats those two exactly the same way
                                            // (fall back to the base price), so this reads
                                            // ?? straight through both.
                                            const override = product.locationPrices.find(
                                              (lp) => lp.locationId === location.id
                                            );
                                            const effectivePrice = override?.sellingPrice ?? product.sellingPrice;
                                            const isEditingThisRow =
                                              editingLocation?.productId === product.id &&
                                              editingLocation?.locationId === location.id;
                                            const isStagedThisRow =
                                              locationDraft?.productId === product.id &&
                                              locationDraft?.locationId === location.id;
                                            // Busy from anything OTHER than this exact row —
                                            // another location row on this or another product,
                                            // or the article's own price/rename form.
                                            const rowBusy =
                                              editingId !== null ||
                                              renamingId !== null ||
                                              (anyLocationEditBusy && !isEditingThisRow && !isStagedThisRow);

                                            return (
                                              <Fragment key={location.id}>
                                                <tr>
                                                  <td>{location.name}</td>
                                                  {/* Cost is GLOBAL (Product.costPrice) — read-only
                                                      here, never a location-level input. Rule 111:
                                                      "cost is global and never varies by Location." */}
                                                  <td className="dash-pricing-num">
                                                    {product.costPrice != null ? (
                                                      formatMoney(product.costPrice)
                                                    ) : (
                                                      <span className="badge badge-warning">Pending</span>
                                                    )}
                                                  </td>
                                                  {isEditingThisRow && !isStagedThisRow ? (
                                                    <td className="dash-pricing-num">
                                                      <input
                                                        type="number"
                                                        inputMode="decimal"
                                                        min="0.01"
                                                        step="0.01"
                                                        className="dash-pricing-inline-input"
                                                        value={locationPriceInput}
                                                        onChange={(e) => setLocationPriceInput(e.target.value)}
                                                        onKeyDown={handleLocationEnterKeyContinue}
                                                        autoFocus
                                                      />
                                                    </td>
                                                  ) : isStagedThisRow ? (
                                                    <td className="dash-pricing-num">
                                                      {locationDraft.sellingPrice === null
                                                        ? 'Base price'
                                                        : formatMoney(locationDraft.sellingPrice)}
                                                    </td>
                                                  ) : (
                                                    <td className="dash-pricing-num">
                                                      {/* Deliberately NO visual distinction between
                                                          an override and a fallback-to-base value
                                                          (rule 111's F3 task) — same number, same
                                                          styling, either way. */}
                                                      {effectivePrice != null ? (
                                                        formatMoney(effectivePrice)
                                                      ) : (
                                                        <span className="badge badge-warning">Pending</span>
                                                      )}
                                                    </td>
                                                  )}
                                                  {(() => {
                                                    if (isEditingThisRow && !isStagedThisRow) {
                                                      // Not yet validated/staged — same "—" convention
                                                      // the article-level cost/selling inputs above use
                                                      // while their own step 1 is still open.
                                                      return (
                                                        <>
                                                          <td className="dash-pricing-num muted">—</td>
                                                          <td className="dash-pricing-num muted">—</td>
                                                        </>
                                                      );
                                                    }
                                                    const marginSelling = isStagedThisRow
                                                      ? locationDraft.sellingPrice ?? product.sellingPrice
                                                      : effectivePrice;
                                                    const margin = computeMargin(product.costPrice, marginSelling, formatMoney);
                                                    return (
                                                      <>
                                                        <td className="dash-pricing-num">{margin.rupees}</td>
                                                        <td className="dash-pricing-num">{margin.percent}</td>
                                                      </>
                                                    );
                                                  })()}
                                                  <td className="dash-pricing-action">
                                                    <div className="dash-table-action-row">
                                                      {isEditingThisRow ? (
                                                        isStagedThisRow ? null : (
                                                          <div className="action-row">
                                                            <button
                                                              type="button"
                                                              className="link-button"
                                                              onClick={handleContinueLocationEdit}
                                                            >
                                                              Continue
                                                            </button>
                                                            <button
                                                              type="button"
                                                              className="link-button"
                                                              onClick={handleUseBaseLocationPrice}
                                                            >
                                                              Use base price
                                                            </button>
                                                            <button
                                                              type="button"
                                                              className="link-button"
                                                              onClick={handleCancelLocationEdit}
                                                            >
                                                              Cancel
                                                            </button>
                                                          </div>
                                                        )
                                                      ) : (
                                                        <button
                                                          type="button"
                                                          className="link-button"
                                                          onClick={() =>
                                                            handleStartLocationEdit(product, location.id, effectivePrice)
                                                          }
                                                          disabled={!user.hasPinSet || rowBusy}
                                                        >
                                                          Edit
                                                        </button>
                                                      )}
                                                    </div>
                                                  </td>
                                                </tr>
                                                {isEditingThisRow && !isStagedThisRow && locationFormError && (
                                                  <tr className="dash-pricing-error-row">
                                                    <td colSpan={6}>
                                                      <p className="error-banner" role="alert">
                                                        {locationFormError}
                                                      </p>
                                                    </td>
                                                  </tr>
                                                )}
                                                {isStagedThisRow && (
                                                  <tr className="dash-pricing-pin-row">
                                                    <td colSpan={6}>
                                                      <p className="muted">
                                                        {locationDraft.sellingPrice === null
                                                          ? `Clearing ${location.name}'s override for ${product.articleNo} — it will bill at the base price again.`
                                                          : `Setting ${location.name}'s price to ${formatMoney(
                                                              locationDraft.sellingPrice
                                                            )} for ${product.articleNo} — ${product.name}.`}{' '}
                                                        Enter your PIN to confirm.
                                                      </p>
                                                      <PinPrompt
                                                        submitLabel="Save price"
                                                        submittingLabel="Saving…"
                                                        autoFocus
                                                        onSubmit={handleConfirmLocationEdit}
                                                      />
                                                      <div className="action-row">
                                                        <button
                                                          type="button"
                                                          className="link-button"
                                                          onClick={() => setLocationDraft(null)}
                                                        >
                                                          Change details
                                                        </button>
                                                        <button
                                                          type="button"
                                                          className="link-button"
                                                          onClick={handleCancelLocationEdit}
                                                        >
                                                          Cancel
                                                        </button>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                )}
                                              </Fragment>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}
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
            </div>
          );
        })
      )}
    </>
  );
}
