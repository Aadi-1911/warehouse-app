import { useEffect, useRef, useState } from 'react';
import { TruckIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import CreatableSelect from '../components/CreatableSelect';
import Combobox from '../components/Combobox';
import { useAuth } from '../hooks/useAuth';
import { listFactories, createFactory } from '../api/factories';
import { listLocations, createLocation } from '../api/locations';
import { listColors, createColor } from '../api/colors';
import { listCategories, createCategory, deactivateCategory, reactivateCategory } from '../api/categories';
import { createBundle } from '../api/bundles';
import {
  findExactMatch,
  getValidColors,
  createProduct,
  updateProduct,
  reactivateProduct,
} from '../api/products';
import PinPrompt from '../components/PinPrompt';
import { createTransaction } from '../api/transactions';
import { KIDS_PIECES_BY_LABEL, piecesPerSetFor } from '../utils/piecesPerSet';

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
//
// Derived from the imported KIDS_PIECES_BY_LABEL (not a separate local table) so the chip
// labels shown here can never drift from the actual conversion piecesPerSetFor uses.
const KIDS_CATEGORIES = Object.entries(KIDS_PIECES_BY_LABEL).map(([label, pieces]) => ({ label, pieces }));

// --- Deferred creation (2026-08-28). Nothing this screen does — typing an article number, naming
// it, setting sizes, picking or inventing a colour — writes anything to the database any more.
// Product, ProductSize, Color and Bundle are all created at ONE point: "Save receipt", inside
// handleSaveReceiptConfirmed, immediately before the Transaction that gives them a reason to
// exist. Before that, they live only in React state.
//
// Why this had to change: all three used to POST the instant they were entered, so simply walking
// away from a half-filled form — closing the tab, backgrounding the PWA, tapping "Change" —
// permanently left a real Product (with its ProductSize rows), a real Color, and/or a real Bundle
// behind, for stock that was never received. Those orphans are indistinguishable from genuine
// records afterwards: they show up in article lookups, in the colour picker, in Live Stock at 0
// sets. The database recorded an INTENTION, not an event.
//
// A "pending" record still needs an id, because the whole colour-staging/receipt-grouping UI keys
// off ids. These prefixes make a synthetic one recognisable at a glance and impossible to confuse
// with a real cuid, so the save path can tell which of the two it's holding.
//
// The suffix is DERIVED from the record's own identity (factory+articleNo, or the colour's name),
// never a counter. That's what makes it stable: searching the same brand-new article twice in one
// session produces the same synthetic id both times, so the receipt table merges them into one
// group (rule 53) exactly as it does for an article that already exists — and the save path's
// dedupe cache below gets a second, independent guarantee that only one real record is created.
const PENDING_PRODUCT_PREFIX = 'pending-product::';
const PENDING_COLOR_PREFIX = 'pending-color::';

function pendingProductId(factoryId, articleNo) {
  return `${PENDING_PRODUCT_PREFIX}${factoryId}::${articleNo.trim().toLowerCase()}`;
}

// Lowercased on purpose — the server's own uniqueness check for a Color is case-insensitive
// (colorController.js), so "Navy" and "navy" must resolve to ONE pending colour here too, or the
// save path would try to create the second and take a 409 for something the UI should never have
// offered twice in the first place.
function pendingColorId(name) {
  return `${PENDING_COLOR_PREFIX}${name.trim().toLowerCase()}`;
}

function isPendingColorId(id) {
  return typeof id === 'string' && id.startsWith(PENDING_COLOR_PREFIX);
}

// One adult size and its quantity-in-the-set. Extracted rather than repeated because all three
// adult size rows (Common, Extended, and the "+ add other size" S row) render exactly this, and
// the whole point of the interaction is that every chip looks and behaves identically — three
// hand-copied versions is precisely how that stops being true after the next edit.
//
// The stepper is ALWAYS rendered, at qty 0 for a size that isn't in the set yet — never revealed
// only after a size is "selected". That's deliberate and was validated against a working mockup
// before this was built: there's no separate select-then-set-quantity mode to discover, the first
// "+" is what includes the size (0 -> 1), which is the same single tap the previous toggle-chip
// needed. "−" is disabled at 0 rather than hidden, so the control's shape never shifts as it's
// used. Reuses the app's existing .stepper/.stepper-btn/.stepper-value classes (§3.4's "circular
// +/- buttons flanking a centered number", never a raw number input) rather than a new control.
function SizeStepperChip({ label, qty, onAdjust }) {
  const included = qty > 0;
  return (
    <div className={`size-stepper-chip${included ? ' size-stepper-chip-included' : ''}`}>
      <span className="size-stepper-label">{label}</span>
      <div className="stepper size-stepper">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onAdjust(label, -1)}
          disabled={!included}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        {/* aria-live so a screen reader announces the new count on each tap — the number is the
            only thing that changes, and it's the entire meaning of the interaction. */}
        <span className="stepper-value" aria-live="polite">
          {qty}
        </span>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onAdjust(label, 1)}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
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

  // Category archive/reactivate (rule 85) — tucked behind its own toggle since this form is
  // mainly about picking a category quickly, not managing them. Deliberately separate from
  // categoryId/categories above: this is admin housekeeping on the underlying list, not part of
  // picking one for the article being created.
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [showArchivedCategories, setShowArchivedCategories] = useState(false);
  const [categoryActionBusyId, setCategoryActionBusyId] = useState(null);
  const [categoryActionError, setCategoryActionError] = useState(null);

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
  // ADULT ONLY — { sizeLabel: qty } for sizes actually in the set, e.g. { M: 1, L: 2, XL: 1 }.
  // Replaced a plain array of selected labels (2026-08-25) when a size became able to appear more
  // than once in one set. A label is present in this object ONLY while its qty is > 0: stepping a
  // size back down to 0 deletes its key rather than storing a zero, which keeps "is this label a
  // key" meaning exactly "is this size part of the set" — the same thing the old array's
  // membership meant, so every downstream check stays a presence check rather than becoming a
  // "present but might be zero" check. It also matches ProductSize's own invariant, so the
  // request body this builds can never contain a zero-qty row.
  const [sizeQtys, setSizeQtys] = useState({});
  const [selectedKidsCategory, setSelectedKidsCategory] = useState(null); // KIDS ONLY — one label or null, never counted
  const [showExtraSize, setShowExtraSize] = useState(false);
  // No `creatingArticle` flag any more: "Create article" no longer makes a network call, so there
  // is no in-flight window for a "Creating…" label to describe. It doesn't just resolve fast — it
  // never leaves the browser, so a spinner would be describing a request that doesn't exist.
  const [createArticleError, setCreateArticleError] = useState(null);

  // --- Reactivating an archived article (2026-08-28).
  //
  // Two genuinely different paths, and the split is deliberate rather than an inconsistency:
  //
  //   No price change -> DEFERRED. Reactivation is staged on the receipt line and only happens at
  //   "Save receipt", inside resolveBundleForLine, exactly like Product/Color/Bundle creation.
  //   Walking away from the form leaves the article archived, with no trace — which is the whole
  //   point of the deferred-creation work this builds on.
  //
  //   Price change -> IMMEDIATE. A price edit requires OWNER + PIN (CLAUDE.md's non-negotiable
  //   rule, rule 71), and every PIN-gated price edit in this app already commits the moment the
  //   PIN is confirmed (Article Pricing's inline edit, Factory Payables' payment/debit forms).
  //   Deferring a PIN-confirmed action would mean holding a verified PIN's authority in browser
  //   state until some later, unrelated button — so the price, and the reactivation that comes
  //   with it, land together at confirmation time.
  //
  // priceEditOpen only ever opens for an OWNER: PATCH /api/products/:id is requireRole('OWNER')
  // unconditionally (routes/products.js), not merely PIN-gated, and productSelect() never even
  // selects costPrice for a STAFF request — so there is no version of this form a STAFF user
  // could meaningfully fill in, and it isn't rendered for them at all.
  const [priceEditOpen, setPriceEditOpen] = useState(false);
  const [newCostPrice, setNewCostPrice] = useState('');
  const [newSellingPrice, setNewSellingPrice] = useState('');
  const [priceEditSuccess, setPriceEditSuccess] = useState(null);

  // --- Color staging. "Resolved" = colors this screen has settled on for the current Product.
  // Each entry is { id, name, bundleId } — bundleId is a REAL Bundle id only for colours that
  // were bulk-fetched from a genuinely matched article (getValidColors below). It is null for
  // every colour picked during this session, because no Bundle is created any more until save
  // time; null is the flag the save path reads to know it must resolve one (see
  // resolveBundleForLine). "Resolved" therefore now means "settled on", not "already exists".
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

  // The full global color list — ALWAYS fetched alongside resolvedColors for a matched/
  // justCreated article, not just when the article starts with zero colors of its own. This is
  // what makes "+ Add new color" a genuine, permanently-reachable escape hatch rather than a
  // one-time bootstrap path: an article that already has real colors can still reach every
  // OTHER color in the system, not just the ones already bundled to it (the REAL GAP this
  // replaced — see LEARNING_LOG.md). An earlier version of this screen only ever fetched this
  // list while a `colorBootstrapMode` flag was true, itself only ever set for a zero-color
  // article — meaning the moment an article got its first real color, the fallback list became
  // permanently unreachable for that article, forever, including on every future re-search.
  const [globalColors, setGlobalColors] = useState([]);
  // Same three states, for the same reason: the fetch kicking off and this list actually
  // arriving are two different moments, and the render in between must not claim "no colors
  // exist in the system yet" while the fetch hasn't even started.
  const [globalColorsStatus, setGlobalColorsStatus] = useState('idle');
  const [globalColorsError, setGlobalColorsError] = useState(null);
  // `bundleCreating` / `bundleCreateError` are gone with the eager POST they described. Picking a
  // colour is now pure local state, so there is no request to be mid-flight and none to fail; a
  // colour that can't be made real is discovered at save time and reported through the existing
  // failed-lines banner, alongside every other reason a line couldn't be saved.

  // Colours invented via "+ Create new color" this session. These are NOT in the database yet, so
  // no fetch will ever return them — without keeping them here they'd vanish from the picker the
  // moment the next article was looked up (resetLookup clears globalColors, and the refetch that
  // follows can only return real ones). Deliberately NOT cleared by resetLookup: a colour typed
  // once should stay offered for the rest of the receiving session, exactly as it did back when
  // creating it wrote a real row immediately.
  const [pendingColors, setPendingColors] = useState([]);
  // The same colours again, as a Map, purely so they can be read back in the SAME tick they were
  // added. Combobox calls onChange(created.id) immediately after its onCreate promise resolves —
  // before React has re-rendered — so handleColorChange reading `pendingColors` there would be
  // reading the previous render's array and would find nothing, leaving the staged entry with a
  // blank colour name. A ref is the only thing that's already updated at that point.
  const pendingColorsRef = useRef(new Map());

  // The one color actively being set up (picked, not yet staged). Picked via Combobox
  // (components/Combobox.jsx, added 2026-08-22) — a live-filtering text input replacing the
  // CreatableSelect + separate search box this screen briefly had; the filtering (and the
  // "already selected" safety net) now lives entirely inside Combobox itself, not here.
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

  // The REAL GAP fix: this now runs on the exact same condition as resolvedColors' own fetch
  // above (any matched/justCreated article), not on a one-time "started with zero colors" flag.
  // A previous version gated this behind `colorBootstrapMode`, which only ever turned on for a
  // zero-color article and never turned back off — so an article with even one real color could
  // never reach this list again, on this lookup or any future re-search of the same article.
  useEffect(() => {
    if (lookup?.status !== 'matched') {
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
  }, [lookup]);

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

  // Archive/reactivate a Category (rule 85) — no PIN, matching every other archive/reactivate
  // action in this app (only price edits require one). Updates the same categories list the
  // picker reads from, so an archived category drops out of it immediately without a re-fetch.
  async function handleArchiveCategory(category) {
    setCategoryActionBusyId(category.id);
    setCategoryActionError(null);
    try {
      const updated = await deactivateCategory(category.id);
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      // An archived category shouldn't stay silently selected for the article being created.
      if (categoryId === category.id) setCategoryId('');
    } catch (err) {
      setCategoryActionError(err.message);
    } finally {
      setCategoryActionBusyId(null);
    }
  }

  async function handleReactivateCategory(category) {
    setCategoryActionBusyId(category.id);
    setCategoryActionError(null);
    try {
      const updated = await reactivateCategory(category.id);
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setCategoryActionError(err.message);
    } finally {
      setCategoryActionBusyId(null);
    }
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
    setSizeQtys({});
    setSelectedKidsCategory(null);
    setShowExtraSize(false);
    setCreateArticleError(null);
    // The reactivation price form belongs to the article being looked at, so it closes with it.
    // A price ALREADY committed through it isn't undone by this — that write is real and done;
    // this only clears the form's own transient state.
    setPriceEditOpen(false);
    setNewCostPrice('');
    setNewSellingPrice('');
    setPriceEditSuccess(null);
    setResolvedColors([]);
    // Back to 'idle', not 'loaded' — after a reset nothing has been asked about the next
    // article yet. Leaving these settled would hand the next lookup a stale "answer already
    // known" for an article it has never queried, which is the exact confusion this replaced.
    setResolvedColorsStatus('idle');
    setResolvedColorsError(null);
    setGlobalColors([]);
    setGlobalColorsStatus('idle');
    setGlobalColorsError(null);
    // pendingColors is deliberately NOT reset here — see its own declaration above.
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
      // `archived` rides alongside status rather than becoming a status of its own (2026-08-28).
      // Everything downstream of the lookup — both colour-fetch effects, handleColorChange,
      // handleAddToReceipt — branches on `status === 'matched'`, and an archived article needs
      // every one of those behaviours unchanged: it's a real Product with real Bundles and real
      // sizes. Only the banner and the reactivation affordance differ, so only they read the flag.
      //
      // Worth being explicit that this is NOT a new capability: GET /api/products has never
      // filtered on isActive (productController.js's listProducts builds its where-clause from
      // factoryId/articleNo alone), so findExactMatch has ALWAYS returned archived articles and
      // this screen has always let stock be received against one. What it couldn't do was say so
      // — an archived match rendered as an ordinary green "Matched" banner, identical to an
      // active article. This flag is what makes an already-reachable state visible.
      setLookup(
        match
          ? { status: 'matched', product: match, archived: !match.isActive }
          : { status: 'new', articleNo: articleNo.trim() }
      );
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setLookingUp(false);
    }
  }

  // --- New-article sizing.
  // One handler for both stepper buttons. Every size chip renders an identical −/qty/+ stepper
  // from the moment the sizing step loads, with no special-casing for "not yet selected" — the
  // first "+" takes a size from 0 (excluded) to 1 (included), which is the same single tap the
  // old toggle-chip needed, so the common no-repeat case costs no extra taps. Stepping down to 0
  // deletes the key outright rather than storing a zero (see sizeQtys' own comment).
  function adjustSize(label, delta) {
    setSizeQtys((prev) => {
      const next = { ...prev };
      const updated = (next[label] ?? 0) + delta;
      if (updated <= 0) delete next[label];
      else next[label] = updated;
      return next;
    });
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
    setSizeQtys({});
    setSelectedKidsCategory(null);
    setShowExtraSize(false);
  }

  // Builds the new article LOCALLY — no POST. Everything gathered here (name, category, kids
  // flag, sizes) is exactly the body createProduct will eventually be given; it's just held in
  // React state until the receipt is actually saved. Synchronous now, because nothing leaves the
  // browser: the screen moves straight into colour staging, same as it always did.
  function handleCreateArticle() {
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
    if (!isKids && Object.keys(sizeQtys).length === 0) {
      setCreateArticleError('Select at least one size.');
      return;
    }

    // Kids: exactly one ProductSize row, storing WHICH category was chosen — piece count is
    // never derived from this array's length (see piecesPerSet below), just the category label
    // itself. No qty sent at all: Kids is a fixed per-category lookup, so a qty would be a field
    // nothing reads, and omitting it lets the column default (1) stand.
    //
    // Adult: still canonical order rather than tap order (ADULT_SIZE_ORDER), now carrying each
    // size's own qty. Filtering on presence in sizeQtys is exactly the old `.includes(label)`
    // check — a label is only ever a key while its qty is > 0 — so a size stepped back down to 0
    // is naturally absent here rather than being sent as a zero-qty row.
    const sizes = isKids
      ? [{ sizeLabel: selectedKidsCategory, sortOrder: 0 }]
      : ADULT_SIZE_ORDER.filter((label) => sizeQtys[label] > 0).map((label, index) => ({
          sizeLabel: label,
          sortOrder: index,
          qty: sizeQtys[label],
        }));

    // A pending Product, shaped exactly like a real one for everything downstream that reads it.
    // piecesPerSetFor() only needs `isKids` + `sizes` (with each row's qty), and the receipt
    // table only needs articleNo/name/id — all of which are here, so nothing below this point
    // has to know or care that the record doesn't exist in the database yet. The extra fields
    // (factoryId, categoryId) are carried because they're part of the eventual POST body, not
    // because the UI reads them.
    const product = {
      id: pendingProductId(factoryId, lookup.articleNo),
      articleNo: lookup.articleNo,
      factoryId,
      name: newArticleName.trim(),
      categoryId,
      isKids,
      sizes,
    };

    // Transition into the SAME color-staging UI the Matched branch uses — justCreated is what
    // tells the effects/handlers above this Product has no Bundles to fetch. That was already
    // true when the Product was created eagerly (a brand-new article genuinely had zero
    // Bundles); it's true for a different reason now (the Product itself doesn't exist yet), but
    // the behaviour it needs to drive — don't call getValidColors — is identical either way.
    setLookup({ status: 'matched', product, justCreated: true });
  }

  // Commits a new price AND the reactivation together, immediately, the moment the PIN is
  // confirmed — the deliberate exception to this screen's "everything defers to Save receipt"
  // rule. See priceEditOpen's own declaration for why deferring a PIN-confirmed action would be
  // the wrong call.
  //
  // Passed to PinPrompt as its onSubmit, so PinPrompt owns the PIN field, the submit button, the
  // in-flight label, and the INVALID_PIN "(N attempts remaining)" rendering — this function never
  // touches any of that. Throwing from here is the documented way to surface an error through
  // PinPrompt's own banner, which is why the price validation below throws rather than setting
  // some separate error state.
  async function handleReactivateWithPrice(pin) {
    const parsedCost = Number(newCostPrice);
    const parsedSelling = Number(newSellingPrice);
    if (!newCostPrice || !parsedCost || parsedCost <= 0) {
      throw new Error('Enter a valid cost price.');
    }
    if (!newSellingPrice || !parsedSelling || parsedSelling <= 0) {
      throw new Error('Enter a valid selling price.');
    }

    // TWO calls, not one, and this was verified rather than assumed: PATCH /api/products/:id
    // accepts only categoryId/isKids/costPrice/sellingPrice (PATCHABLE_FIELDS in
    // productController.js) — isActive is deliberately not patchable there, so reactivation has
    // its own dedicated endpoint and cannot ride along in the price request.
    //
    // Price first, reactivate second, on purpose. If the second call fails, the article is left
    // archived but correctly re-priced, and the line still carries its deferred reactivation
    // intent (staged below), so "Save receipt" will finish the job — the failure degrades into
    // the no-price path rather than into an inconsistent state. The reverse order would leave an
    // article reactivated at a stale price, which is the worse of the two.
    const updated = await updateProduct(lookup.product.id, {
      costPrice: parsedCost,
      sellingPrice: parsedSelling,
      pin,
    });
    const reactivated = await reactivateProduct(lookup.product.id);

    // The line is now an ordinary matched line for the rest of the flow: archived flag cleared,
    // so nothing downstream stages a redundant reactivation at save time. Merging both responses
    // keeps whichever fields each one actually returned rather than assuming either is complete.
    setLookup((prev) =>
      prev ? { ...prev, product: { ...prev.product, ...updated, ...reactivated }, archived: false } : prev
    );
    setPriceEditOpen(false);
    setPriceEditSuccess(
      `${lookup.product.articleNo} reactivated, and its price updated. Both are saved already — they don't wait for "Save receipt".`
    );
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

  // Picking a colour writes nothing any more. It used to POST a Bundle the first time a colour
  // was chosen for an article — which is precisely how abandoning a form left phantom Bundles
  // behind (Wine/Sky Blue, investigated earlier). The Bundle is created at save time instead, by
  // resolveBundleForLine, from the colour recorded here.
  //
  // Synchronous now, deliberately: there is no request to await, and Combobox calls this directly
  // from its own onChange, so keeping it async would only add a microtask before the UI updates.
  //
  // knownColor lets a caller that already holds the colour object pass it in rather than have
  // this read it back out of state that may not have re-rendered yet.
  function handleColorChange(newColorId, knownColor) {
    setStagedColors((prev) => finalizeActiveColor(prev));

    // bundleId: null means "this colour still needs a real Bundle" — the save path's signal, and
    // the reason nothing here needs to distinguish a brand-new colour from an existing one that
    // simply has no Bundle for this article yet. Both are equally unmade until the receipt is
    // saved, and both are made the same way.
    //
    // The guard is still on resolvedColors (not stagedColors): re-selecting a colour that was
    // picked then abandoned at 0 sets must not add a second entry for it. The functional-update
    // form re-checks inside the setter as well, so this stays correct even if two picks land
    // before a re-render.
    const alreadyResolved = resolvedColors.some((c) => c.id === newColorId);
    if (!alreadyResolved) {
      const color =
        knownColor ?? pendingColorsRef.current.get(newColorId) ?? globalColors.find((c) => c.id === newColorId);
      setResolvedColors((prev) =>
        prev.some((c) => c.id === newColorId)
          ? prev
          : [...prev, { id: newColorId, name: color?.name ?? '', bundleId: null }]
      );
    }

    setSelectedColorId(newColorId);
    setCurrentSets(0);
    setCurrentDamaged(false);
  }

  // Inline "+ Create new color" — now records the colour locally and returns it; POST /api/colors
  // happens at save time. Returning the object matters: Combobox's triggerCreate does
  // `onChange(created.id)` with whatever this resolves to, which is what actually selects the new
  // colour. (The old version returned undefined, so that line read `.id` off undefined and threw
  // straight into Combobox's catch — the colour got selected by this function's own
  // handleColorChange call, but an error banner appeared underneath it for no reason. Fixed here
  // by returning the object and letting Combobox drive selection through the one normal path,
  // rather than this function selecting it too and the change handler running twice — which would
  // have folded the active colour into stagedColors twice over.)
  function handleCreateColor(name) {
    const trimmed = name.trim();

    // The server refuses a duplicate colour name case-insensitively (409 DUPLICATE_COLOR). With
    // creation deferred, that check has to happen here instead, or two spellings of one colour
    // would stage as two separate entries and only reveal themselves as one at save time.
    // Returning the existing colour makes "create" quietly resolve to "select" — the same outcome
    // the person wanted, without an error they can't act on.
    const existing = colorPickerSource.find((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const color = { id: pendingColorId(trimmed), name: trimmed };
    // Ref first, state second — Combobox reads this back within the same tick (see
    // pendingColorsRef's own comment), and the state update won't have landed by then.
    pendingColorsRef.current.set(color.id, color);
    setPendingColors((prev) => [...prev, color]);
    return color;
  }

  function handleRemoveStaged(colorId) {
    setStagedColors((prev) => prev.filter((s) => s.colorId !== colorId));
  }

  // Makes "stage this color, then pick another" an explicit, visible action rather than
  // something only discoverable by already knowing that picking a different color from the
  // dropdown silently finalizes whatever was active before it (finalizeActiveColor already runs
  // there too — this button does the exact same thing, just as its own first-class step). Per
  // the standing rule that a non-obvious interaction needs its own visible affordance: without
  // this, the only way to learn multi-color staging works is to already know to try it.
  function handleStageAnother() {
    setStagedColors((prev) => finalizeActiveColor(prev));
    setSelectedColorId('');
    setCurrentSets(0);
    setCurrentDamaged(false);
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
    const piecesPerSet = piecesPerSetFor(lookup.product);

    // For an article that doesn't exist yet, snapshot the exact POST body createProduct will be
    // given at save time. Snapshotted for the same reason Factory/Location are (rule 52): this
    // entry is committed to the receipt now, and must not be re-derived later from form state
    // that has since been reset for the next article.
    //
    // null for a genuinely matched article — that's the flag the save path reads to know the
    // Product is already real and productId can be used as-is.
    const pendingProduct = lookup.product.id.startsWith(PENDING_PRODUCT_PREFIX)
      ? {
          articleNo: lookup.product.articleNo,
          factoryId: lookup.product.factoryId,
          name: lookup.product.name,
          categoryId: lookup.product.categoryId,
          isKids: lookup.product.isKids,
          sizes: lookup.product.sizes,
        }
      : null;

    // Deferred reactivation intent (2026-08-28), staged in exactly the same shape and at exactly
    // the same moment as pendingProduct above, so it travels with the line and gets resolved at
    // the same single point (resolveBundleForLine) rather than through a separate mechanism.
    //
    // Only set when the article is STILL archived at commit time. An OWNER who already went
    // through the price path has had `archived` cleared on the lookup, because that path already
    // reactivated for real — re-staging it here would queue a redundant second reactivate call
    // for something that is no longer archived.
    const reactivateProductId = lookup.archived ? lookup.product.id : null;

    const entry = {
      id: nextReceiptIdRef.current++,
      articleNo: lookup.product.articleNo,
      productId: lookup.product.id,
      productName: lookup.product.name,
      piecesPerSet,
      pendingProduct,
      reactivateProductId,
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
  // The picker source is ALWAYS the union of this article's own real colors (resolvedColors)
  // and every color that exists in the system (globalColors), deduplicated by id — this is the
  // REAL GAP fix. The article's own colors still surface first in practice (resolvedColors is
  // spread first), but a color that only exists in globalColors is reachable too, always, not
  // just while an article happens to have zero colors of its own. Picking one that isn't yet
  // resolved runs through the exact same auto-Bundle-creation path handleColorChange already
  // has (it checks resolvedColors, not "am I in some fallback mode") — nothing downstream of
  // the picker itself needed to change for this fix.
  //
  // pendingColors joins the merge (2026-08-28): a colour invented this session isn't in the
  // database yet, so listColors() can never return it. Without it here, typing a new colour for
  // article A and then looking up article B would silently lose it from the picker — the person
  // would have to type it again, and (deterministic ids aside) it would look to them as though
  // the colour they just made had been thrown away.
  const colorPickerSource = (() => {
    const seen = new Set();
    const merged = [];
    for (const c of [...resolvedColors, ...globalColors, ...pendingColors]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
    return merged;
  })();
  const availableColors = colorPickerSource.filter((c) => !stagedColors.some((s) => s.colorId === c.id));
  // Live filtering, keyboard nav, and the "already-selected stays valid" guarantee all live
  // inside Combobox now (components/Combobox.jsx) — this screen just hands it the same
  // already-fetched, already-deduplicated list it always computed for the old CreatableSelect.
  // Both lists matter now, always — there's no more mode where only one of them is the picker's
  // real source, so both must have settled before the picker can honestly report anything.
  const colorListsSettled = resolvedColorsStatus === 'loaded' && globalColorsStatus === 'loaded';
  // "+ Create new color" is always offered now (canCreate is unconditional below), so the
  // select never needs disabling just because availableColors is empty — that escape hatch is
  // always the way forward. The only genuine blocker left is the lists not having settled;
  // "mid-create" is gone along with the POST that used to happen on every colour pick.
  const colorSelectDisabled = !colorListsSettled;
  // Two genuinely different empty states, needing different guidance (never say "no colors for
  // this article" when the real problem is "no colors exist anywhere yet", and vice versa — the
  // person reading it can't act correctly on the wrong one). No longer gated to a one-time
  // bootstrap mode — either can be true for any article, at any point, including a re-search.
  function colorSelectPlaceholder() {
    // Every branch below this line asserts something specific about what colors exist. None of
    // them may be reached until the lists have actually settled — otherwise the message is a
    // claim about data that hasn't arrived. 'Loading…' covers 'idle' as well as 'loading':
    // from the user's side "not asked yet" and "asked, waiting" are the same experience, and
    // both are honest, which "All colors staged" was not.
    if (!colorListsSettled) return 'Loading…';
    if (availableColors.length > 0) return 'Select color';
    return colorPickerSource.length === 0
      ? 'No colors exist in the system yet — create the first one below'
      : 'All colors staged'; // every existing color (this article's own + global) already picked
  }
  const canAddToReceipt = stagedColors.length > 0 || (!!selectedColorId && currentSets > 0);
  // Adult: the SUM of every chip's qty, not a count of how many chips are non-zero — this is what
  // makes M,L,L,XL read "4 pieces per set" live as it's built, matching what piecesPerSetFor will
  // compute from the saved rows afterwards. Kids: a direct lookup the moment a category is picked
  // — no counting and no summing, 0 until something is actually selected (rule 50, revised).
  const piecesPerSet = isKids
    ? (selectedKidsCategory ? KIDS_PIECES_BY_LABEL[selectedKidsCategory] : 0)
    : Object.values(sizeQtys).reduce((sum, q) => sum + q, 0);

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
          // Everything the save path needs to make this line's records real, carried on the line
          // itself rather than looked up from state at submit time — a retry after a partial
          // failure re-submits these same line objects, and the form state they came from is
          // long gone by then.
          productId: item.productId,
          pendingProduct: item.pendingProduct,
          reactivateProductId: item.reactivateProductId,
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

  // Turns one submission line into a REAL Bundle id, creating whatever doesn't exist yet along
  // the way: Product (+ its ProductSize rows) -> Color -> Bundle. This is the single place the
  // deferred records actually become real, and it runs immediately before that line's
  // Transaction — so a record is only ever written when there is genuine received stock to
  // attach to it.
  //
  // `caches` is created once per save run and shared across every line. That's what satisfies
  // "create each record once, not once per line": a receipt with four colour lines for the same
  // brand-new article creates ONE Product, and two lines using the same new colour create ONE
  // Color. The lookup keys are the records' real identities (factory+articleNo, lowercased
  // colour name), not the synthetic ids, so two lines that arrived from separate lookups of the
  // same new article still collapse to one create.
  //
  // Every step is look-up-first or recover-on-409, never a bare create. Three separate things
  // make that necessary rather than defensive:
  //   - A retry after a partial save re-runs this for lines that already got their Product made
  //     on the first attempt. Without the lookup, the retry would 409 and fail the line forever.
  //   - Someone else may have created the same article/colour between the form being filled in
  //     and the receipt being saved. That's a normal outcome of deferring, not an error — the
  //     right answer is to use theirs.
  //   - The 409 responses deliberately don't carry the existing row's id (colorController.js /
  //     bundleController.js), so recovering from one MEANS re-reading. There's no shortcut.
  async function resolveBundleForLine(line, caches) {
    // 1. Product. A real productId is used as-is; a pending one is created (or found).
    let productId = line.productId;
    if (line.pendingProduct) {
      const key = `${line.pendingProduct.factoryId}::${line.pendingProduct.articleNo.trim().toLowerCase()}`;
      if (caches.products.has(key)) {
        productId = caches.products.get(key);
      } else {
        const existing = await findExactMatch(line.pendingProduct.factoryId, line.pendingProduct.articleNo);
        const product = existing ?? (await createProduct(line.pendingProduct));
        productId = product.id;
        caches.products.set(key, productId);
      }
    }

    // 1b. Reactivation (2026-08-28). An archived article that stock is being received against
    // becomes active again — but only now, at save time, so abandoning the form leaves it
    // archived with no trace, exactly like every other deferred record on this screen.
    //
    // Deliberately AFTER product resolution and BEFORE the Bundle/Transaction work: by the time
    // any new stock is attached, the article it attaches to is already active again.
    //
    // Needs no 409/duplicate recovery, unlike Color and Bundle above — reactivateProduct is
    // idempotent by construction (productController.js sets isActive: true unconditionally and
    // returns 200 whether or not it was already true), so a retry after a partial save is safe
    // with no special handling. The cache is still worth having: it keeps a receipt with four
    // colour lines against one archived article to a single reactivate call rather than four
    // identical ones, the same "once per record, not once per line" guarantee the caches above give.
    if (line.reactivateProductId) {
      if (!caches.reactivated.has(productId)) {
        await reactivateProduct(productId);
        caches.reactivated.add(productId);
      }
    }

    // 2. Colour. Only ever pending for one this session invented — a colour picked from the real
    // list already carries its real id.
    let colorId = line.colorId;
    if (isPendingColorId(colorId)) {
      const key = line.colorName.trim().toLowerCase();
      if (caches.colors.has(key)) {
        colorId = caches.colors.get(key);
      } else {
        try {
          colorId = (await createColor({ name: line.colorName.trim() })).id;
        } catch (err) {
          if (err.code !== 'DUPLICATE_COLOR') throw err;
          // The name is taken — by an earlier retry of this same line, or by someone else. Find
          // it the same case-insensitive way the server matched it.
          const all = await listColors();
          const match = all.find((c) => c.name.trim().toLowerCase() === key);
          if (!match) throw err; // genuinely unresolvable — let the line fail honestly
          colorId = match.id;
        }
        caches.colors.set(key, colorId);
      }
    }

    // 3. Bundle. A non-null bundleId can only have come from getValidColors on a genuinely
    // matched article, so it's real and needs nothing further.
    if (line.bundleId) return line.bundleId;

    const key = `${productId}::${colorId}`;
    if (caches.bundles.has(key)) return caches.bundles.get(key);

    let bundleId;
    try {
      bundleId = (await createBundle(productId, colorId)).id;
    } catch (err) {
      if (err.code !== 'DUPLICATE_BUNDLE') throw err;
      const valid = await getValidColors(productId);
      const match = valid.find((c) => c.id === colorId);
      if (!match?.bundleId) throw err;
      bundleId = match.bundleId;
    }
    caches.bundles.set(key, bundleId);
    return bundleId;
  }

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

    // One set of caches for the whole run — see resolveBundleForLine. Scoped to this run rather
    // than the component: once these records are real, the NEXT save must re-verify against the
    // database rather than trust ids from a run that may have partly failed.
    // `reactivated` is a Set, not a Map: unlike the other three it isn't resolving an identity to
    // an id, only remembering which products this run has already reactivated so a multi-line
    // receipt doesn't repeat the call.
    const caches = {
      products: new Map(),
      colors: new Map(),
      bundles: new Map(),
      reactivated: new Set(),
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        // Inside the same try as the Transaction on purpose: if a line's Product/Colour/Bundle
        // can't be made, that line simply failed to save, which is already a state this screen
        // handles — it stays in the table with everything it needs to be retried. A separate
        // resolution phase up front would be worse: it would create records for lines whose
        // Transactions later fail, which is the exact orphan problem this change removes.
        const bundleId = await resolveBundleForLine(line, caches);
        await createTransaction({
          bundleId,
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
      // Every pending colour is a real Color row now, so the synthetic entries must go — leaving
      // them would keep offering a fake id for a colour the next listColors() will return
      // properly, and picking it would send the save path resolving something already resolved.
      pendingColorsRef.current.clear();
      setPendingColors([]);
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
      {/* tone="tile-green" (2026-08-27) matches Home's Receive Stock tile exactly, per Aadi's
          confirmed tap-a-tile/land-on-that-colour continuity — was "success" (the shared
          --success-* green), which is a DIFFERENT green from the new dedicated --tile-green-*
          tokens. Flagged, not silently touched: this page's own "Matched" lookup banner and its
          Save-receipt result banner/confirm modal (below) still genuinely mean success and still
          use the original --success-* green — two different greens now share this one screen,
          reported to Aadi rather than decided here. See LEARNING_LOG.md. */}
      <ScreenHeader icon={<TruckIcon size={20} />} tone="tile-green" title="Receive Stock" />

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
            {/* Three visually distinct states now, not two (2026-08-28). An ARCHIVED match gets
                the amber warning treatment rather than the green success one, because green here
                means "this is ready to receive into, carry on" and an archived article isn't
                quite that — it's receivable, but doing so changes its status, which the person
                should know before they do it rather than discover afterwards. Amber is the same
                colour this screen already uses for its "New article" state, and for the same
                reason: something other than the straightforward path is about to happen. The two
                amber states are never ambiguous with each other — they can't co-occur (an article
                is either found or not), and each spells out its own consequence in words. */}
            <div
              className={`lookup-banner ${
                lookup.archived ? 'lookup-banner-warning' : 'lookup-banner-success'
              }`}
            >
              <p>
                {lookup.archived ? (
                  <>
                    <strong>Archived article:</strong> {lookup.product.articleNo} —{' '}
                    {lookup.product.name} is archived. Receiving stock against it will reactivate
                    it when you save this receipt.
                  </>
                ) : lookup.justCreated ? (
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

            {/* Confirmation that the immediate (price) path already committed — deliberately
                explicit that these did NOT wait for "Save receipt", since everything else on this
                screen does, and that difference is exactly what would otherwise be surprising. */}
            {priceEditSuccess && (
              <p className="result-banner result-banner-success">{priceEditSuccess}</p>
            )}

            {/* OWNER-only, and not merely by convention: PATCH /api/products/:id is
                requireRole('OWNER') unconditionally (routes/products.js) — a STAFF request is
                rejected for the role before the PIN is even considered — and productSelect()
                never selects costPrice for STAFF, so there'd be no current price to show them
                either. Rendering this for STAFF would be an affordance that cannot succeed.
                STAFF still reactivate archived articles perfectly well: they just take the
                deferred no-price path, which is the default and needs no extra interaction. */}
            {lookup.archived && isOwner && !priceEditOpen && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPriceEditOpen(true);
                  // Pre-fill with the CURRENT prices rather than blank: this form always sets
                  // BOTH fields (PATCH replaces each value it's given), so starting empty would
                  // quietly invite someone updating only the selling price to wipe the cost
                  // price — or force them to re-type a number they didn't intend to change.
                  setNewCostPrice(
                    lookup.product.costPrice != null ? String(lookup.product.costPrice) : ''
                  );
                  setNewSellingPrice(
                    lookup.product.sellingPrice != null ? String(lookup.product.sellingPrice) : ''
                  );
                }}
              >
                Update price while reactivating
              </button>
            )}

            {lookup.archived && isOwner && priceEditOpen && (
              <div className="card reactivate-price-form">
                <h3 className="card-title">Reactivate with a new price</h3>
                {/* The current values, shown plainly so the new number is entered against a
                    known starting point rather than from memory. "Not set yet" is a real state
                    (rule 8/71's pending-price article), not a missing value to hide. */}
                <p className="muted hint-text">
                  Current cost{' '}
                  <strong>
                    {lookup.product.costPrice != null
                      ? `₹${Number(lookup.product.costPrice).toLocaleString('en-IN')}`
                      : 'not set yet'}
                  </strong>{' '}
                  · Current selling{' '}
                  <strong>
                    {lookup.product.sellingPrice != null
                      ? `₹${Number(lookup.product.sellingPrice).toLocaleString('en-IN')}`
                      : 'not set yet'}
                  </strong>
                </p>

                <div className="field-row">
                  <label className="field">
                    <span className="field-label">New cost price</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={newCostPrice}
                      onChange={(e) => setNewCostPrice(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">New selling price</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={newSellingPrice}
                      onChange={(e) => setNewSellingPrice(e.target.value)}
                    />
                  </label>
                </div>

                <p className="muted hint-text">
                  Unlike the rest of this screen, this saves straight away — the price change and
                  the reactivation both happen as soon as your PIN is confirmed, not when the
                  receipt is saved.
                </p>

                {/* The shared PinPrompt (components/PinPrompt.jsx), not a hand-built PIN field —
                    it already owns the field, the submit button, the in-flight label, and the
                    INVALID_PIN "(N attempts remaining)" rendering that this action can genuinely
                    hit. handleReactivateWithPrice throws on invalid prices, which is how those
                    messages reach PinPrompt's own error banner. */}
                <PinPrompt
                  submitLabel="Confirm price & reactivate"
                  submittingLabel="Saving…"
                  onSubmit={handleReactivateWithPrice}
                />

                <button
                  type="button"
                  className="link-button"
                  onClick={() => setPriceEditOpen(false)}
                >
                  Cancel — reactivate without changing the price
                </button>
              </div>
            )}

            <div className="color-staging">
              {/* Combobox (components/Combobox.jsx, added 2026-08-22) — one live-filtering text
                  input replacing the CreatableSelect + separate search box this screen briefly
                  had. Same value shape (selectedColorId), same handlers, same always-reachable
                  "+ Create new color" — only how it's picked changed. */}
              <Combobox
                fieldLabel="Color"
                value={selectedColorId}
                onChange={handleColorChange}
                options={availableColors}
                disabled={colorSelectDisabled}
                placeholder={colorSelectPlaceholder()}
                canCreate // REAL GAP fix: always reachable, not just while an article has zero colors of its own
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

              {/* Explicit, always-visible "stage more" step — distinct from "Add to receipt"
                  below, which commits the WHOLE group. Disabled until there's an active color +
                  quantity actually worth staging, same guard finalizeActiveColor itself uses. */}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleStageAnother}
                disabled={!selectedColorId || currentSets <= 0}
              >
                + Add another color
              </button>

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
                // Archived categories drop out of the default picker (rule 85), matching how an
                // archived Color/Factory/Location already behaves elsewhere in this app.
                options={categories.filter((c) => c.isActive)}
                disabled={listsLoading}
                placeholder={listsLoading ? 'Loading…' : 'Select category'}
                canCreate
                onCreate={handleCreateCategory}
              />

              {/* Deliberately small and tucked away — this form is mainly about picking a
                  category quickly, not managing them, so archive/reactivate lives behind its
                  own toggle rather than sitting inline with every category all the time. No PIN
                  needed, matching every other archive/reactivate action in the app. */}
              <button
                type="button"
                className="link-button"
                onClick={() => setCategoryManagerOpen((v) => !v)}
              >
                {categoryManagerOpen ? 'Hide categories' : 'Manage categories'}
              </button>

              {categoryManagerOpen && (
                <div className="category-manager">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={showArchivedCategories}
                      onChange={(e) => setShowArchivedCategories(e.target.checked)}
                    />
                    Show archived
                  </label>

                  {categoryActionError && (
                    <p className="error-banner" role="alert">
                      {categoryActionError}
                    </p>
                  )}

                  {categories
                    .filter((c) => showArchivedCategories || c.isActive)
                    .map((c) => (
                      <div key={c.id} className="category-manager-row">
                        <span className={c.isActive ? '' : 'muted'}>{c.name}</span>
                        {!c.isActive && <span className="badge badge-danger">Archived</span>}
                        {c.isActive ? (
                          <button
                            type="button"
                            className="link-button danger-text"
                            onClick={() => handleArchiveCategory(c)}
                            disabled={categoryActionBusyId === c.id}
                          >
                            {categoryActionBusyId === c.id ? 'Archiving…' : 'Archive'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleReactivateCategory(c)}
                            disabled={categoryActionBusyId === c.id}
                          >
                            {categoryActionBusyId === c.id ? 'Reactivating…' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}

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
                    {/* Rule 49's row structure is unchanged — Common always visible, Extended
                        always visible, S only via "+ add other size". Only what each row's chip
                        IS changed: a stepper instead of a toggle. */}
                    <div className="chip-row size-stepper-row">
                      {COMMON_ADULT_SIZES.map((label) => (
                        <SizeStepperChip
                          key={label}
                          label={label}
                          qty={sizeQtys[label] ?? 0}
                          onAdjust={adjustSize}
                        />
                      ))}
                    </div>
                    <div className="chip-row size-stepper-row">
                      {EXTENDED_ADULT_SIZES.map((label) => (
                        <SizeStepperChip
                          key={label}
                          label={label}
                          qty={sizeQtys[label] ?? 0}
                          onAdjust={adjustSize}
                        />
                      ))}
                    </div>
                    {showExtraSize ? (
                      <div className="chip-row size-stepper-row">
                        <SizeStepperChip
                          label={EXTRA_ADULT_SIZE}
                          qty={sizeQtys[EXTRA_ADULT_SIZE] ?? 0}
                          onAdjust={adjustSize}
                        />
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
              >
                Create article
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
