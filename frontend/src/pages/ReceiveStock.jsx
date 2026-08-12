import { useEffect, useRef, useState } from 'react';
import { TruckIcon } from '../components/icons';
import ConfirmModal from '../components/ConfirmModal';
import { useAuth } from '../hooks/useAuth';
import { listFactories, createFactory } from '../api/factories';
import { listLocations, createLocation } from '../api/locations';
import { listColors, createColor } from '../api/colors';
import { listCategories, createCategory } from '../api/categories';
import { createBundle } from '../api/bundles';
import { findExactMatch, getValidColors, createProduct } from '../api/products';
import { createTransaction } from '../api/transactions';

// Receive Stock — 07_UI_DESIGN_BRIEF.md §5.2 / §6 Round 6 refinements / 05_BUSINESS_RULES.md
// rules 49-53.
//
// This slice covers: session-level Factory/Location dropdowns, the article-lookup step
// (Matched vs. New-article banner), multi-color staging under a Matched article, and the
// full New-article branch — size selection, article creation, then the SAME color-staging
// flow, now against a real freshly-created Product. The receipt table's final grouped
// rendering and POST /api/transactions (Save receipt) are still separate, later tasks.

// Rule 49: no sizes pre-selected. Common row always visible; Extended row always visible
// (never hidden behind anything); S is only revealed via "+ add other size".
const COMMON_ADULT_SIZES = ['M', 'L', 'XL', 'XXL'];
const EXTENDED_ADULT_SIZES = ['3XL', '4XL', '5XL', '6XL'];
const EXTRA_ADULT_SIZE = 'S';
// Canonical display/storage order, independent of the order staff happened to tap them in —
// this is what ProductSize.sortOrder is built from, not click sequence.
const ADULT_SIZE_ORDER = [EXTRA_ADULT_SIZE, ...COMMON_ADULT_SIZES, ...EXTENDED_ADULT_SIZES];

// Rule 50 (revised): three fixed, SINGLE-select categories, swapped in wholesale by the Kids
// toggle. Unlike adult sizing, piece count is not derived by counting selections — it's a
// fixed property of whichever one category is chosen. Age ranges overlap deliberately (12-16
// falls in both the 2nd and 3rd); staff pick whichever matches the actual garment, the same way
// they'd pick "M" vs "L" — the system never resolves an age to a range programmatically.
const KIDS_CATEGORIES = [
  { label: '1-5yr', pieces: 5 },
  { label: '6-16yr', pieces: 6 },
  { label: '12-18yr', pieces: 4 },
];
const KIDS_PIECES_BY_LABEL = Object.fromEntries(KIDS_CATEGORIES.map((c) => [c.label, c.pieces]));

// A sentinel option value, distinct from any real id (cuids never contain a space), so picking
// it can be told apart from picking a real Factory/Location/Color.
const CREATE_NEW_VALUE = '__create_new__';

// A <select> that can also grow its own list inline — 01_PRD.md §5.2/§5.4/§5.6 all describe
// Factory/Color/Location as lists that grow "as needed" from right inside the app, not from a
// separate admin screen. Picking "+ Create new…" swaps the select for a name field; submitting
// it calls onCreate(name), and the caller is responsible for adding the result to its own list
// and selecting it — this component only owns the toggle between "picking" and "typing a name".
function CreatableSelect({ fieldLabel, value, onChange, options, disabled, placeholder, canCreate, onCreate }) {
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

export default function ReceiveStock() {
  // Location creation is OWNER-only on the backend (locationController.js); Factory/Color are
  // open to any role. Only Location's "+ Create new…" option needs to be gated on this.
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  // --- Session-level selects: "One receiving session = one Location, selected once" (§5.2).
  const [factories, setFactories] = useState([]);
  const [locations, setLocations] = useState([]);
  // Categories is a flat, global, always-available list — same shape as Factory/Location, NOT
  // the scoped-with-bootstrap-fallback pattern Colors needs (colors are valid-for-a-specific-
  // Product via Bundle; a Category is never scoped to anything). Fetched once at mount alongside
  // Factory/Location for exactly that reason.
  const [categories, setCategories] = useState([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState(null);

  const [factoryId, setFactoryId] = useState('');
  const [locationId, setLocationId] = useState('');

  // --- Article lookup step.
  const [articleNo, setArticleNo] = useState('');
  // null = nothing looked up yet. Otherwise { status: 'matched', product, justCreated? } or
  // { status: 'new', articleNo }. justCreated marks a 'matched'-shaped lookup that was actually
  // just created by this screen (see handleCreateArticle) — same downstream color-staging
  // code path, but it needs to know its Product has zero Bundles yet, not "matched" ones.
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState(null);

  // --- New-article branch: name + size selection, then "Create article".
  const [newArticleName, setNewArticleName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isKids, setIsKids] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState([]); // ADULT ONLY — labels, any order, counting-based (unchanged)
  const [selectedKidsCategory, setSelectedKidsCategory] = useState(null); // KIDS ONLY — one label or null, never counted
  const [showExtraSize, setShowExtraSize] = useState(false);
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [createArticleError, setCreateArticleError] = useState(null);

  // --- Color staging. "Resolved" = colors we know for certain have a real Bundle for the
  // current Product — either bulk-fetched (Matched article) or built one-by-one as each is
  // first picked (a justCreated article, which starts with zero Bundles).
  const [resolvedColors, setResolvedColors] = useState([]);
  // 'idle' | 'loading' | 'loaded' — NOT a boolean. A boolean here has a genuine hole in it: it
  // can only say "am I fetching right now", so "haven't started yet" and "finished, found
  // nothing" both read as false, and an empty list is indistinguishable between them. That
  // ambiguity was a real rendered bug, not a theoretical one — a fetch is kicked off by an
  // effect, which by definition runs AFTER the render that first shows this UI, so EVERY
  // article lookup committed one render claiming "loaded and empty" before the request had
  // even been made (measured: 100% of lookups, ~2-6ms, showing "All colors staged", disabled).
  // 'idle' gives that moment its own name, so the UI can hold rather than assert something false.
  const [resolvedColorsStatus, setResolvedColorsStatus] = useState('idle');
  const [resolvedColorsError, setResolvedColorsError] = useState(null);

  // Set once per lookup, not recomputed live from resolvedColors.length: whether this article
  // started its color-staging session with zero colors of its own — justCreated always does; a
  // matched article does too if getValidColors comes back empty (see the fetch effect below).
  // Deliberately a snapshot, not a live check — resolvedColors legitimately GROWS as colors get
  // picked during a bootstrap session (X, then Y, then Z, all still drawn from the global list),
  // and re-deriving this from "is it empty right now" would flip the picker's source away from
  // the global list after the very first pick, hiding every other not-yet-resolved color.
  const [colorBootstrapMode, setColorBootstrapMode] = useState(false);

  // Only populated while colorBootstrapMode is true — the full picker list a color gets chosen
  // FROM, before it has a Bundle (and therefore before it belongs in resolvedColors).
  const [globalColors, setGlobalColors] = useState([]);
  // Same three states, for the same reason: colorBootstrapMode flipping true and this list
  // actually arriving are two different moments, and the render in between was claiming "no
  // colors exist in the system yet" while the fetch hadn't started.
  const [globalColorsStatus, setGlobalColorsStatus] = useState('idle');
  const [globalColorsError, setGlobalColorsError] = useState(null);
  const [bundleCreating, setBundleCreating] = useState(false);
  const [bundleCreateError, setBundleCreateError] = useState(null);

  // The one color actively being set up (picked, not yet staged).
  const [selectedColorId, setSelectedColorId] = useState('');
  const [currentSets, setCurrentSets] = useState(0);
  const [currentDamaged, setCurrentDamaged] = useState(false); // "Damaged on arrival" for the active color, per §5.2/§6

  // Finalized colors for the current article: { colorId, colorName, bundleId, sets, damaged }[].
  const [stagedColors, setStagedColors] = useState([]);

  // --- Session-level receipt list: survives an article reset, unlike everything above it.
  const [receiptItems, setReceiptItems] = useState([]);
  const nextReceiptIdRef = useRef(0);

  // --- Save Receipt: null | 'summary' | 'final' drives which of the two sequential
  // ConfirmModal steps is open (rule: double confirmation before a live-stock write).
  const [saveConfirmStep, setSaveConfirmStep] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null); // { done, total } while saving
  // Set once submission finishes: { succeededCount, failedLines }. Drives the plain-language
  // result banner — null the rest of the time.
  const [saveOutcome, setSaveOutcome] = useState(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([listFactories(), listLocations(), listCategories()])
      .then(([factoryList, locationList, categoryList]) => {
        if (cancelled) return;
        setFactories(factoryList);
        setLocations(locationList);
        setCategories(categoryList);
      })
      .catch((err) => {
        if (cancelled) return;
        setListsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Bulk-fetch valid colors for a genuinely MATCHED article only — a justCreated one has zero
  // Bundles by definition (it was just created), so there's nothing to fetch; its
  // resolvedColors instead grows one entry at a time from handleColorChange below.
  useEffect(() => {
    // Nothing looked up (or a New-article form on screen): there is no article to have colors
    // for, so this genuinely hasn't been asked yet — 'idle', not a finished empty fetch.
    if (lookup?.status !== 'matched') {
      setResolvedColorsStatus('idle');
      return;
    }
    // A justCreated article has zero Bundles by definition, so there is nothing to fetch — but
    // that IS a settled answer, not an unasked question. Marking it 'loaded' is what keeps the
    // picker from sitting disabled forever on the New-article path, where no request ever runs.
    if (lookup.justCreated) {
      setResolvedColorsStatus('loaded');
      return;
    }

    let cancelled = false;
    setResolvedColorsStatus('loading');
    setResolvedColorsError(null);

    getValidColors(lookup.product.id)
      .then((colors) => {
        if (cancelled) return;
        setResolvedColors(colors);
        // A matched article found with zero existing Bundles needs exactly the same bootstrap
        // treatment as a justCreated one — see article 6056 in LEARNING_LOG.md for why this
        // matters: without it, an article that was created but abandoned before its first color
        // stays permanently stuck the next time it's looked up, since "matched" alone no longer
        // implies "has colors."
        if (colors.length === 0) setColorBootstrapMode(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setResolvedColorsError(err.message);
      })
      .finally(() => {
        // 'loaded' means "the question has been answered", which is true whether the answer was
        // a list, an empty list, or a failure — the error case surfaces through
        // resolvedColorsError's own banner, and leaving the status un-settled on error would
        // strand the picker disabled with no way forward.
        if (!cancelled) setResolvedColorsStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [lookup]);

  useEffect(() => {
    if (!colorBootstrapMode) {
      setGlobalColorsStatus('idle');
      return;
    }

    let cancelled = false;
    setGlobalColorsStatus('loading');
    setGlobalColorsError(null);

    listColors()
      .then((colors) => {
        if (cancelled) return;
        setGlobalColors(colors);
      })
      .catch((err) => {
        if (cancelled) return;
        setGlobalColorsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setGlobalColorsStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [colorBootstrapMode]);

  // Changing Factory OR Location invalidates any lookup already on screen — matching is
  // scoped to a single Factory (Critical Interaction Rule #3), and rule 52 requires each
  // finalized entry to snapshot the Factory/Location that were active when it was staged.
  // Letting either change silently underneath an in-progress lookup would risk committing
  // staged colors under the wrong (or a since-cleared) Factory/Location.
  function handleFactoryChange(newFactoryId) {
    setFactoryId(newFactoryId);
    resetLookup();
  }

  function handleLocationChange(newLocationId) {
    setLocationId(newLocationId);
    resetLookup();
  }

  // Inline "+ Create new factory/location" — lands on the same POST endpoints Manage
  // Users/Factories already use elsewhere, just reachable from right where the need for a new
  // one actually comes up (01_PRD.md §5.2/§5.6: both grow "as needed", not from a fixed list).
  // Newly created record is added to the already-fetched list and selected immediately, exactly
  // as if it had already existed.
  async function handleCreateFactory(name) {
    const factory = await createFactory({ name });
    setFactories((prev) => [...prev, factory]);
    handleFactoryChange(factory.id);
  }

  async function handleCreateLocation(name) {
    const location = await createLocation({ name });
    setLocations((prev) => [...prev, location]);
    handleLocationChange(location.id);
  }

  // Inline "+ Create new category" — same POST /api/categories endpoint a future Category
  // Management screen would use, reachable right where the need for one actually comes up
  // during New-article creation. Newly created record is appended to the already-fetched list
  // and selected immediately, same pattern as Factory/Location/Color.
  async function handleCreateCategory(name) {
    const category = await createCategory({ name });
    setCategories((prev) => [...prev, category]);
    setCategoryId(category.id);
  }

  // Full reset for the current article attempt: used by "Change" (abandon a wrong lookup) and
  // automatically after a successful "Add to receipt" commit (Round 7: the panel resets so the
  // next article can be searched immediately). Deliberately does NOT touch receiptItems —
  // already-committed entries keep their own snapshotted Factory/Location/colors regardless of
  // what happens to the in-progress article afterward.
  function resetLookup() {
    setLookup(null);
    setLookupError(null);
    setArticleNo('');
    setNewArticleName('');
    setCategoryId('');
    setIsKids(false);
    setSelectedSizes([]);
    setSelectedKidsCategory(null);
    setShowExtraSize(false);
    setCreatingArticle(false);
    setCreateArticleError(null);
    setResolvedColors([]);
    // Back to 'idle', not 'loaded' — after a reset nothing has been asked about the next
    // article yet. Leaving these settled would hand the next lookup a stale "answer already
    // known" for an article it has never queried, which is the exact confusion this replaced.
    setResolvedColorsStatus('idle');
    setResolvedColorsError(null);
    setColorBootstrapMode(false);
    setGlobalColors([]);
    setGlobalColorsStatus('idle');
    setGlobalColorsError(null);
    setBundleCreateError(null);
    setSelectedColorId('');
    setCurrentSets(0);
    setCurrentDamaged(false);
    setStagedColors([]);
  }

  async function handleAdd() {
    setLookupError(null);

    if (!factoryId || !locationId) {
      setLookupError('Select a Factory and Location first.');
      return;
    }
    if (!articleNo.trim()) {
      setLookupError('Enter an article number.');
      return;
    }

    setLookingUp(true);
    try {
      const match = await findExactMatch(factoryId, articleNo);
      setLookup(
        match
          ? { status: 'matched', product: match }
          : { status: 'new', articleNo: articleNo.trim() }
      );
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setLookingUp(false);
    }
  }

  // --- New-article sizing.
  function toggleSize(label) {
    setSelectedSizes((prev) => (prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]));
  }

  // Switching sizing systems clears BOTH systems' selections (rule 50) — a "3XL" or a
  // "6-16yr" pick is meaningless once the vocabulary underneath it has changed. Two separate
  // state variables now (adult stays counting-based, Kids is single-select), so both get
  // cleared together regardless of which direction the toggle just moved.
  function handleKidsToggle() {
    // Smart-default the Category picker to "Kids" the moment the toggle switches ON — but only
    // that one transition, and only ever a default, never a lock. Turning it back OFF
    // deliberately leaves whatever category is currently selected untouched: the person may
    // have already picked something more specific (e.g. "Hoodie") and there's no reason to
    // clear a real choice just because the sizing system changed back. If the "Kids" Category
    // hasn't loaded yet (or was renamed/removed), this silently no-ops — the picker just starts
    // unselected, same as any other fresh New-article form, still fully usable.
    if (!isKids) {
      const kidsCategory = categories.find((c) => c.name === 'Kids');
      if (kidsCategory) setCategoryId(kidsCategory.id);
    }
    setIsKids((prev) => !prev);
    setSelectedSizes([]);
    setSelectedKidsCategory(null);
    setShowExtraSize(false);
  }

  async function handleCreateArticle() {
    setCreateArticleError(null);

    if (!newArticleName.trim()) {
      setCreateArticleError('Enter a name for this article.');
      return;
    }
    if (!categoryId) {
      setCreateArticleError('Select a category.');
      return;
    }
    if (isKids && !selectedKidsCategory) {
      setCreateArticleError('Select an age category.');
      return;
    }
    if (!isKids && selectedSizes.length === 0) {
      setCreateArticleError('Select at least one size.');
      return;
    }

    // Kids: exactly one ProductSize row, storing WHICH category was chosen — piece count is
    // never derived from this array's length (see piecesPerSet below), just the category label
    // itself. Adult: unchanged, canonical order rather than click order — see ADULT_SIZE_ORDER.
    const sizes = isKids
      ? [{ sizeLabel: selectedKidsCategory, sortOrder: 0 }]
      : ADULT_SIZE_ORDER.filter((label) => selectedSizes.includes(label)).map((label, index) => ({
          sizeLabel: label,
          sortOrder: index,
        }));

    setCreatingArticle(true);
    try {
      const product = await createProduct({
        articleNo: lookup.articleNo,
        factoryId,
        name: newArticleName.trim(),
        categoryId,
        isKids,
        sizes,
      });
      // Transition into the SAME color-staging UI the Matched branch uses — justCreated is
      // what tells the effects/handlers above this Product has no Bundles yet.
      setLookup({ status: 'matched', product, justCreated: true });
      setColorBootstrapMode(true);
    } catch (err) {
      setCreateArticleError(err.message);
    } finally {
      setCreatingArticle(false);
    }
  }

  // --- Color staging (shared by Matched and justCreated articles).

  // Shared by the color-switch handler and "Add to receipt": folds the currently active color
  // (if it has any sets on it) into stagedColors. Returns the resulting array so a caller that
  // needs it immediately (handleAddToReceipt) isn't stuck waiting on the next render.
  function finalizeActiveColor(currentStaged) {
    if (!selectedColorId || currentSets <= 0) return currentStaged;
    const color = resolvedColors.find((c) => c.id === selectedColorId);
    return [
      ...currentStaged,
      {
        colorId: selectedColorId,
        colorName: color?.name ?? '',
        bundleId: color?.bundleId ?? null,
        sets: currentSets,
        damaged: currentDamaged,
      },
    ];
  }

  // knownColor lets a caller that already has the freshly-fetched/created color object (see
  // handleCreateColor) pass it directly, instead of this function reading it back out of
  // globalColors — that state update wouldn't have landed yet if called in the same tick a color
  // was just created, since setGlobalColors is async like any other state setter.
  async function handleColorChange(newColorId, knownColor) {
    setStagedColors((prev) => finalizeActiveColor(prev));

    // No Bundle exists until the FIRST time a color is picked for this Product — that pick is
    // what makes it real. Checking resolvedColors (not stagedColors, and no longer gated on
    // justCreated specifically — a matched article with zero colors of its own needs exactly the
    // same bootstrapping) means re-selecting a color that was picked-then-abandoned (0 sets,
    // switched away from) never re-POSTs; its Bundle already exists from the first time.
    const alreadyResolved = resolvedColors.some((c) => c.id === newColorId);
    if (!alreadyResolved) {
      setBundleCreateError(null);
      setBundleCreating(true);
      try {
        const bundle = await createBundle(lookup.product.id, newColorId);
        const color = knownColor ?? globalColors.find((c) => c.id === newColorId);
        setResolvedColors((prev) => [...prev, { id: newColorId, name: color?.name ?? '', bundleId: bundle.id }]);
      } catch (err) {
        setBundleCreateError(err.message);
        setBundleCreating(false);
        return; // don't select a color whose Bundle creation just failed
      }
      setBundleCreating(false);
    }

    setSelectedColorId(newColorId);
    setCurrentSets(0);
    setCurrentDamaged(false);
  }

  // Inline "+ Create new color" — creates the master Color record (POST /api/colors, same
  // endpoint Color Management would use if it existed as its own screen) and then runs it
  // through the exact same auto-Bundle-creation path as picking any other unresolved color, so
  // there's no separate, unverified code path for a color that happens to be brand new.
  async function handleCreateColor(name) {
    const color = await createColor({ name });
    setGlobalColors((prev) => [...prev, color]);
    await handleColorChange(color.id, color);
  }

  function handleRemoveStaged(colorId) {
    setStagedColors((prev) => prev.filter((s) => s.colorId !== colorId));
  }

  function handleAddToReceipt() {
    // Rule 51: a color picked but never explicitly staged must still be included, not dropped.
    const finalColors = finalizeActiveColor(stagedColors);
    if (finalColors.length === 0) return; // guarded by the disabled button too

    // lookup.product.sizes is populated for BOTH branches, not just Matched: productSelect
    // (productController.js, backend) always includes sizes regardless of role, and
    // createProduct's own response is built from that same select — so a just-created
    // article's Product object already carries the sizes it was created with, no separate
    // plumbing needed from the sizing step's own state. Reading it fresh here, right at commit
    // time, is what actually guarantees this rather than assuming it.
    //
    // isKids branches the computation itself (rule 50, revised): a Kids article stores exactly
    // ONE ProductSize row (the chosen category), so sizes.length would always be 1 — piece
    // count instead comes from the fixed category lookup, never from counting rows. Adult
    // sizing is untouched: sizes.length is still exactly the piece count there.
    const piecesPerSet = lookup.product.isKids
      ? KIDS_PIECES_BY_LABEL[lookup.product.sizes[0]?.sizeLabel] ?? 0
      : lookup.product.sizes.length;

    const entry = {
      id: nextReceiptIdRef.current++,
      articleNo: lookup.product.articleNo,
      productId: lookup.product.id,
      productName: lookup.product.name,
      piecesPerSet,
      // Snapshotted now, not read live later (rule 52) — a later Factory/Location change
      // must not retroactively alter an already-committed entry.
      factoryId,
      locationId,
      colors: finalColors,
    };

    setReceiptItems((prev) => [...prev, entry]);
    resetLookup();
  }

  // Removes every committed entry for one article at once — "the whole group," not a single
  // color row. A group can legitimately be built from more than one receiptItems entry (staff
  // searching and committing the same article twice in one session), so this can't just filter
  // out a single id.
  function handleRemoveGroup(productId) {
    setReceiptItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  const lookupDone = lookup !== null;
  const sessionReady = !!factoryId && !!locationId;
  // The picker source: this article's own colors, unless colorBootstrapMode says it started this
  // session with zero of them (rule 5/5.5 — stock-entry for an established article stays scoped
  // to its real Bundles, never the noisy full global list; the fallback exists only to bootstrap
  // an article's very first color, whether it's brand new or just never got one).
  const usingGlobalColorFallback = colorBootstrapMode;
  const colorPickerSource = usingGlobalColorFallback ? globalColors : resolvedColors;
  const availableColors = colorPickerSource.filter((c) => !stagedColors.some((s) => s.colorId === c.id));
  // The gate is "has every list this article actually depends on finished being fetched",
  // expressed positively — NOT "is nothing currently in flight". Those differ precisely at the
  // 'idle' moments, which is the whole point: an un-started fetch has nothing in flight either.
  // Which lists matter depends on the source: in bootstrap mode the picker is populated from
  // globalColors, so resolvedColors having settled says nothing useful on its own — and
  // colorBootstrapMode flips true in the same batch that resolvedColors settles, one render
  // BEFORE the globalColors request starts, which is when the UI used to claim "no colors
  // exist in the system yet" while a color did exist.
  const colorListsSettled = usingGlobalColorFallback
    ? resolvedColorsStatus === 'loaded' && globalColorsStatus === 'loaded'
    : resolvedColorsStatus === 'loaded';
  // Disabled only when genuinely nothing can be done: still loading, mid-create, or (the
  // non-fallback case) this article's own colors are all already staged with no "+ Create new"
  // offered to fall back on. In the fallback case the select stays enabled even at zero real
  // options, purely so "+ Create new color" remains reachable — that's the whole fix.
  const colorSelectDisabled = !colorListsSettled || bundleCreating || (availableColors.length === 0 && !usingGlobalColorFallback);
  // Two genuinely different empty states, needing different guidance (rule: never say "no
  // colors for this article" when the real problem is "no colors exist anywhere yet", and vice
  // versa — the person reading it can't act correctly on the wrong one). Both only apply while
  // usingGlobalColorFallback is true (this article has zero colors of its own) — an established
  // article with real colors just gets the plain "Select color"/"All colors staged" it always did.
  function colorSelectPlaceholder() {
    // Every branch below this line asserts something specific about what colors exist. None of
    // them may be reached until the lists have actually settled — otherwise the message is a
    // claim about data that hasn't arrived. 'Loading…' covers 'idle' as well as 'loading':
    // from the user's side "not asked yet" and "asked, waiting" are the same experience, and
    // both are honest, which "All colors staged" was not.
    if (!colorListsSettled) return 'Loading…';
    if (bundleCreating) return 'Adding color…';
    if (!usingGlobalColorFallback) return availableColors.length === 0 ? 'All colors staged' : 'Select color';
    if (globalColors.length === 0) return 'No colors exist in the system yet — create the first one below';
    return availableColors.length === 0
      ? 'All colors staged' // every existing color has already been picked for this article
      : 'This article has no colors yet — pick one below, or create a new one';
  }
  const canAddToReceipt = stagedColors.length > 0 || (!!selectedColorId && currentSets > 0);
  // Adult: counting-based, unchanged. Kids: a direct lookup the moment a category is picked —
  // no counting, 0 until something is actually selected (rule 50, revised).
  const piecesPerSet = isKids
    ? (selectedKidsCategory ? KIDS_PIECES_BY_LABEL[selectedKidsCategory] : 0)
    : selectedSizes.length;

  // Grouped by productId, not assumed to be one receiptItems entry per article — the same
  // article can be searched and committed more than once in a session, and rule 53 wants those
  // merged into a single section, not shown as duplicate article groups.
  const groupedReceipt = receiptItems.reduce((groups, item) => {
    let group = groups.find((g) => g.productId === item.productId);
    if (!group) {
      group = { productId: item.productId, articleNo: item.articleNo, productName: item.productName, rows: [] };
      groups.push(group);
    }
    item.colors.forEach((color) => {
      group.rows.push({
        key: `${item.id}-${color.colorId}`,
        colorName: color.colorName,
        sets: color.sets,
        pieces: color.sets * item.piecesPerSet,
        damaged: color.damaged,
      });
    });
    return groups;
  }, []);

  // Flattens receiptItems into individual submission lines — one per color, each carrying
  // enough of its own identity (entryId + colorId) to be found again afterward, so a failed
  // line can be kept and a succeeded one removed without disturbing the rest.
  function buildSubmissionLines() {
    const lines = [];
    receiptItems.forEach((item) => {
      item.colors.forEach((color) => {
        lines.push({
          entryId: item.id,
          colorId: color.colorId,
          articleNo: item.articleNo,
          colorName: color.colorName,
          bundleId: color.bundleId,
          locationId: item.locationId,
          sets: color.sets,
          damaged: color.damaged,
        });
      });
    });
    return lines;
  }

  // Summary counts for the first confirm step.
  const saveSummaryLines = buildSubmissionLines();
  const saveSummaryTotalSets = saveSummaryLines.reduce((sum, l) => sum + l.sets, 0);
  const saveSummaryDamagedCount = saveSummaryLines.filter((l) => l.damaged).length;

  // Submits every line sequentially — deliberately not Promise.all/batched, and never stops
  // early on a failure. Each POST is independently atomic on the backend; a line that succeeds
  // is a real stock change and must never be undone just because a later line fails. Running
  // every line regardless (rather than stopping at the first error) means the result is always
  // a complete, unambiguous picture — no line is left in an "never even attempted" limbo that
  // would look identical to a real failure from the staff member's side.
  async function handleSaveReceiptConfirmed() {
    const lines = buildSubmissionLines();
    setSaveConfirmStep(null);
    setSaving(true);
    setSaveProgress({ done: 0, total: lines.length });

    const failedLines = [];
    let succeededCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        await createTransaction({
          bundleId: line.bundleId,
          locationId: line.locationId,
          type: 'STOCK_IN',
          qtySets: line.sets,
          // Transaction has no dedicated damaged field (out of scope to add one this task) —
          // note is the one place available to keep this fact on the permanent record at all,
          // rather than letting it vanish the moment the line is submitted.
          note: line.damaged ? 'Damaged on arrival' : undefined,
        });
        succeededCount++;
      } catch {
        failedLines.push(line);
      }
      setSaveProgress({ done: i + 1, total: lines.length });
    }

    setSaving(false);
    setSaveProgress(null);

    if (failedLines.length === 0) {
      // Full success: the whole session is done — clear everything, including Factory/
      // Location, so the screen is genuinely ready for a fresh receiving session.
      setReceiptItems([]);
      setFactoryId('');
      setLocationId('');
      resetLookup();
    } else {
      // Partial (or total) failure: keep ONLY the lines that failed, so the table itself shows
      // exactly what still needs saving — pressing "Save receipt" again requires no re-entry.
      const failedKeys = new Set(failedLines.map((l) => `${l.entryId}:${l.colorId}`));
      setReceiptItems((prev) =>
        prev
          .map((item) => ({
            ...item,
            colors: item.colors.filter((c) => failedKeys.has(`${item.id}:${c.colorId}`)),
          }))
          .filter((item) => item.colors.length > 0)
      );
    }

    setSaveOutcome({ succeededCount, failedLines });
  }

  return (
    <div className="page">
      <header className="screen-header">
        <div className="icon-mark success">
          <TruckIcon size={20} />
        </div>
        <div>
          <div className="eyebrow">Warehouse</div>
          <h1 className="screen-title">Receive Stock</h1>
        </div>
      </header>

      {listsError && (
        <p className="error-banner" role="alert">
          Could not load Factories/Locations: {listsError}
        </p>
      )}

      <div className="field-row">
        <CreatableSelect
          fieldLabel="Factory"
          value={factoryId}
          onChange={handleFactoryChange}
          options={factories}
          disabled={listsLoading}
          placeholder={listsLoading ? 'Loading…' : 'Select factory'}
          canCreate
          onCreate={handleCreateFactory}
        />

        <CreatableSelect
          fieldLabel="Location"
          value={locationId}
          onChange={handleLocationChange}
          options={locations}
          disabled={listsLoading}
          placeholder={listsLoading ? 'Loading…' : 'Select location'}
          canCreate={isOwner}
          onCreate={handleCreateLocation}
        />
      </div>

      <div className="card">
        <h2 className="card-title">Add article to receipt</h2>

        {!sessionReady && (
          <p className="muted hint-text">Select a Factory and Location to begin.</p>
        )}

        <div className="article-lookup-row">
          <label className="field article-no-field">
            <span className="field-label">Article No.</span>
            <input
              type="text"
              value={articleNo}
              onChange={(e) => setArticleNo(e.target.value)}
              disabled={!sessionReady || lookupDone}
              placeholder="e.g. A101"
              autoCapitalize="characters"
            />
          </label>

          {/* "Add" per §6's rename from "Check" — this button looks the article up, it
              doesn't yet commit anything to a receipt. */}
          {!lookupDone && (
            <button
              type="button"
              className="btn-primary btn-inline"
              onClick={handleAdd}
              disabled={!sessionReady || lookingUp}
            >
              {lookingUp ? 'Checking…' : 'Add'}
            </button>
          )}
        </div>

        {lookupError && (
          <p className="error-banner" role="alert">
            {lookupError}
          </p>
        )}

        {/* Matched (or just-created): green confirmation, sizes are fixed — only Color + Sets
            are needed from here. Wording differs slightly for a just-created article, since
            nothing was actually "matched" against an existing record. */}
        {lookup?.status === 'matched' && (
          <>
            <div className="lookup-banner lookup-banner-success">
              <p>
                {lookup.justCreated ? (
                  <>
                    <strong>Created:</strong> {lookup.product.articleNo} — {lookup.product.name}{' '}
                    (sizes set)
                  </>
                ) : (
                  <>
                    <strong>Matched:</strong> {lookup.product.articleNo} — {lookup.product.name}{' '}
                    (sizes already set)
                  </>
                )}
              </p>
              <button type="button" className="link-button" onClick={resetLookup}>
                Change
              </button>
            </div>

            <div className="color-staging">
              <CreatableSelect
                fieldLabel="Color"
                value={selectedColorId}
                onChange={handleColorChange}
                options={availableColors}
                disabled={colorSelectDisabled}
                placeholder={colorSelectPlaceholder()}
                canCreate={usingGlobalColorFallback}
                onCreate={handleCreateColor}
              />

              {resolvedColorsError && (
                <p className="error-banner" role="alert">
                  Could not load colors: {resolvedColorsError}
                </p>
              )}
              {globalColorsError && (
                <p className="error-banner" role="alert">
                  Could not load colors: {globalColorsError}
                </p>
              )}
              {bundleCreateError && (
                <p className="error-banner" role="alert">
                  Could not add that color: {bundleCreateError}
                </p>
              )}

              {selectedColorId && (
                <div className="field">
                  <span className="field-label">Sets</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setCurrentSets((n) => Math.max(0, n - 1))}
                      disabled={currentSets === 0}
                      aria-label="Decrease sets"
                    >
                      −
                    </button>
                    <span className="stepper-value">{currentSets}</span>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setCurrentSets((n) => n + 1)}
                      aria-label="Increase sets"
                    >
                      +
                    </button>
                  </div>

                  {/* Travels with THIS color's staged entry, not the whole article (§5.2/§6) —
                      one color out of several can arrive damaged while the rest are fine. */}
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={currentDamaged}
                      onChange={(e) => setCurrentDamaged(e.target.checked)}
                    />
                    <span>Damaged on arrival</span>
                  </label>
                </div>
              )}

              {stagedColors.length > 0 && (
                <div className="staged-list">
                  {stagedColors.map((s) => (
                    <div key={s.colorId} className="staged-row">
                      <span className="staged-color-name">{s.colorName}</span>
                      <span className="muted">{s.sets} sets</span>
                      {s.damaged && <span className="badge badge-danger">Damaged</span>}
                      <button
                        type="button"
                        className="link-button danger-text"
                        onClick={() => handleRemoveStaged(s.colorId)}
                        aria-label={`Remove ${s.colorName}`}
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
                onClick={handleAddToReceipt}
                disabled={!canAddToReceipt}
              >
                Add to receipt
              </button>
            </div>
          </>
        )}

        {/* New article: amber state, then Name + Sizes, then "Create article". */}
        {lookup?.status === 'new' && (
          <>
            <div className="lookup-banner lookup-banner-warning">
              <p>
                <strong>New article:</strong> {lookup.articleNo} has no existing record for this
                Factory.
              </p>
              <button type="button" className="link-button" onClick={resetLookup}>
                Change
              </button>
            </div>

            <div className="new-article-form">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  type="text"
                  value={newArticleName}
                  onChange={(e) => setNewArticleName(e.target.value)}
                  placeholder="e.g. Round Neck Tee"
                />
              </label>

              {/* Always visible regardless of the Kids toggle's state (03_DATABASE_SCHEMA.md's
                  Category comment is explicit about this) — Category and isKids are independent
                  concepts: isKids drives sizing vocabulary, Category drives browsing/filtering,
                  and a Kids item can still be more specifically categorized (e.g. "Hoodie"). */}
              <CreatableSelect
                fieldLabel="Category"
                value={categoryId}
                onChange={setCategoryId}
                options={categories}
                disabled={listsLoading}
                placeholder={listsLoading ? 'Loading…' : 'Select category'}
                canCreate
                onCreate={handleCreateCategory}
              />

              <div className="field">
                <span className="field-label">Sizes</span>

                <button
                  type="button"
                  className={`chip kids-toggle-chip ${isKids ? 'chip-selected' : ''}`}
                  onClick={handleKidsToggle}
                  aria-pressed={isKids}
                >
                  Kids garment
                </button>

                {!isKids ? (
                  <>
                    <div className="chip-row">
                      {COMMON_ADULT_SIZES.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className={`chip ${selectedSizes.includes(label) ? 'chip-selected' : ''}`}
                          onClick={() => toggleSize(label)}
                          aria-pressed={selectedSizes.includes(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="chip-row">
                      {EXTENDED_ADULT_SIZES.map((label) => (
                        <button
                          key={label}
                          type="button"
                          className={`chip ${selectedSizes.includes(label) ? 'chip-selected' : ''}`}
                          onClick={() => toggleSize(label)}
                          aria-pressed={selectedSizes.includes(label)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {showExtraSize ? (
                      <div className="chip-row">
                        <button
                          type="button"
                          className={`chip ${selectedSizes.includes(EXTRA_ADULT_SIZE) ? 'chip-selected' : ''}`}
                          onClick={() => toggleSize(EXTRA_ADULT_SIZE)}
                          aria-pressed={selectedSizes.includes(EXTRA_ADULT_SIZE)}
                        >
                          {EXTRA_ADULT_SIZE}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="link-button add-other-size-link"
                        onClick={() => setShowExtraSize(true)}
                      >
                        + add other size
                      </button>
                    )}
                  </>
                ) : (
                  // Single-select (rule 50, revised): picking a category REPLACES whatever was
                  // selected before, never adds to it — unlike the adult chip rows above, this
                  // is not a toggle-per-chip. Each chip shows its fixed piece count directly,
                  // since that's an inherent, always-relevant fact about the category itself,
                  // not something only worth revealing after it's chosen.
                  <div className="chip-row">
                    {KIDS_CATEGORIES.map((cat) => (
                      <button
                        key={cat.label}
                        type="button"
                        className={`chip ${selectedKidsCategory === cat.label ? 'chip-selected' : ''}`}
                        onClick={() => setSelectedKidsCategory(cat.label)}
                        aria-pressed={selectedKidsCategory === cat.label}
                      >
                        {cat.label} ({cat.pieces}pc)
                      </button>
                    ))}
                  </div>
                )}

                <p className="muted pieces-readout">
                  = {piecesPerSet} piece{piecesPerSet === 1 ? '' : 's'} per set
                </p>
              </div>

              {createArticleError && (
                <p className="error-banner" role="alert">
                  {createArticleError}
                </p>
              )}

              <button
                type="button"
                className="btn-primary"
                onClick={handleCreateArticle}
                disabled={creatingArticle}
              >
                {creatingArticle ? 'Creating…' : 'Create article'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Plain-language result of the last "Save receipt" attempt. Shown regardless of whether
          anything remains in the table — a full success empties it entirely, so this is the
          only feedback left telling the staff member it actually worked. No status codes, no
          error jargon: just what happened and, if anything, exactly what still needs doing. */}
      {saveOutcome && (
        <div
          className={`result-banner ${
            saveOutcome.failedLines.length === 0 ? 'result-banner-success' : 'result-banner-warning'
          }`}
        >
          {saveOutcome.failedLines.length === 0 ? (
            <p>
              <strong>Receipt saved.</strong> Stock has been updated.
            </p>
          ) : saveOutcome.succeededCount === 0 ? (
            <p>
              <strong>Nothing could be saved right now.</strong> Nothing in your receipt was
              lost — please check your connection and try again.
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {saveOutcome.succeededCount} of{' '}
                  {saveOutcome.succeededCount + saveOutcome.failedLines.length} lines saved
                </strong>{' '}
                and already added to your stock.
              </p>
              <p>These still need to be saved — please try again:</p>
              <ul className="result-banner-list">
                {saveOutcome.failedLines.map((l, i) => (
                  <li key={i}>
                    {l.articleNo} — {l.colorName} — {l.sets} sets
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="link-button" onClick={() => setSaveOutcome(null)}>
            OK
          </button>
        </div>
      )}

      {/* The real grouped-by-article table (rule 53) — Colour/Sets/Pieces per line, one
          section per article. "Save receipt" submits each color-line as its own
          POST /api/transactions call — local session state made real, sequentially. */}
      {groupedReceipt.length > 0 && (
        <>
          <h2 className="section-heading">This Receipt</h2>
          {groupedReceipt.map((group) => (
            <div key={group.productId} className="card receipt-group">
              <div className="receipt-group-header">
                <div>
                  <span className="receipt-group-article">{group.articleNo}</span>
                  <span className="muted"> — {group.productName}</span>
                </div>
                <button
                  type="button"
                  className="link-button danger-text"
                  onClick={() => handleRemoveGroup(group.productId)}
                >
                  Remove
                </button>
              </div>

              <table className="receipt-table">
                <thead>
                  <tr>
                    <th>Colour</th>
                    <th>Sets</th>
                    <th>Pieces</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.colorName}
                        {row.damaged && (
                          <span className="badge badge-danger receipt-damaged-badge">Damaged</span>
                        )}
                      </td>
                      <td>{row.sets}</td>
                      <td>{row.pieces}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <button
            type="button"
            className="btn-primary"
            onClick={() => setSaveConfirmStep('summary')}
            disabled={saving}
          >
            {saving ? `Saving ${saveProgress.done} of ${saveProgress.total}…` : 'Save receipt'}
          </button>
        </>
      )}

      <ConfirmModal
        open={saveConfirmStep === 'summary'}
        title="Save this receipt?"
        body={`${groupedReceipt.length} article${groupedReceipt.length === 1 ? '' : 's'}, ${
          saveSummaryLines.length
        } colour line${saveSummaryLines.length === 1 ? '' : 's'}, ${saveSummaryTotalSets} set${
          saveSummaryTotalSets === 1 ? '' : 's'
        } in total${
          saveSummaryDamagedCount > 0
            ? ` (including ${saveSummaryDamagedCount} damaged line${saveSummaryDamagedCount === 1 ? '' : 's'})`
            : ''
        }.`}
        confirmLabel="Continue"
        tone="accent"
        onConfirm={() => setSaveConfirmStep('final')}
        onCancel={() => setSaveConfirmStep(null)}
      />

      <ConfirmModal
        open={saveConfirmStep === 'final'}
        title="This cannot be undone"
        body="Saving this receipt updates live stock immediately. This action cannot be undone."
        confirmLabel="Save receipt"
        tone="success"
        onConfirm={handleSaveReceiptConfirmed}
        onCancel={() => setSaveConfirmStep(null)}
      />
    </div>
  );
}
