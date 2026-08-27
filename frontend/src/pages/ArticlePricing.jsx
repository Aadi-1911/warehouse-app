import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { TagIcon, KeyIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { listFactories } from '../api/factories';
import { listProducts, updateProduct, deactivateProduct, reactivateProduct } from '../api/products';
import { listStock } from '../api/stock';

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

// isPending is the same "no price set yet" state 05_BUSINESS_RULES.md rule 8/71 already
// describes (nullable costPrice/sellingPrice) — not a new concept, just the first screen that
// actually surfaces it as something fixable rather than a dead end after Receive Stock.
function isPending(product) {
  return product.costPrice == null || product.sellingPrice == null;
}

// Article Pricing — 07_UI_DESIGN_BRIEF.md §5.10. Owner-only screen, added to Home's "More"
// list. Backed entirely by endpoints that already existed and already enforce the right rules:
// GET /api/products?factoryId= (already role-aware — costPrice is never fetched from Postgres
// for a STAFF request, productSelect() in productController.js) and PATCH /api/products/:id
// (already OWNER+PIN gated the moment costPrice/sellingPrice appear in the body). No new
// backend code exists for this screen at all — see LEARNING_LOG.md for why reusing
// productSelect() here, rather than writing a second role-aware select, was the whole point.
export default function ArticlePricing() {
  const { user } = useAuth();

  // 'idle' | 'loading' | 'loaded' — same three-state shape used everywhere else in this
  // codebase for a fetch that starts from an effect, never a bare boolean.
  const [factories, setFactories] = useState([]);
  const [factoriesStatus, setFactoriesStatus] = useState('idle');
  const [factoriesError, setFactoriesError] = useState(null);

  const [factoryId, setFactoryId] = useState('');

  const [products, setProducts] = useState([]);
  const [productsStatus, setProductsStatus] = useState('idle');
  const [productsError, setProductsError] = useState(null);

  // The product currently being edited (the whole object, not just an id) — null means no form
  // is open. Only one edit form exists at a time, mirroring Factory Payables' activeForm, but a
  // nullable object rather than an enum: there's only one kind of form here ("edit this
  // article's price"), so "which product, if any" is the only thing that varies.
  const [editingProduct, setEditingProduct] = useState(null);
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Show archived — when on, the table shows currently-archived articles for this Factory
  // instead of active ones (requirement 3). Off by default: this screen's primary job is
  // pricing active articles, same "hidden from daily pickers by default" convention rule 85
  // already establishes for every other archivable entity.
  const [showArchived, setShowArchived] = useState(false);

  // Archive/Reactivate — a plain ConfirmModal (no PIN, requirement 4), separate from
  // editingProduct/the price-edit form above, which this task must not touch. null | { product,
  // action: 'archive' | 'reactivate' }.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setFactoriesStatus('loading');
    listFactories()
      .then((list) => {
        if (!cancelled) setFactories(list.filter((f) => f.isActive));
      })
      .catch((err) => {
        if (!cancelled) setFactoriesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setFactoriesStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetches whenever the selected factory changes — same discipline as Factory Payables'
  // own factory switch: drop back to 'loading' with the list cleared on the SAME render that
  // reacts to the id changing, so a slow response for Factory A can never render while Factory
  // B is selected.
  useEffect(() => {
    if (!factoryId) {
      setProductsStatus('idle');
      setProducts([]);
      setProductsError(null);
      return;
    }

    let cancelled = false;
    setProductsStatus('loading');
    setProducts([]);
    setProductsError(null);

    listProducts({ factoryId })
      .then((list) => {
        // Unfiltered — active and archived articles alike, same "backend returns everything,
        // the frontend decides what's visible" pattern already used for Category. showArchived
        // (requirement 3) picks which subset renders; keeping both in one fetch means toggling
        // it never needs a re-fetch.
        if (!cancelled) setProducts(list);
      })
      .catch((err) => {
        if (!cancelled) setProductsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setProductsStatus('loaded');
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId]);

  function handleFactoryChange(newId) {
    setFactoryId(newId);
    // Any in-progress edit belonged to the PREVIOUS factory's article list — closing it rather
    // than leaving it open avoids saving a price against a row that's no longer even visible.
    setEditingProduct(null);
    setSuccessMessage(null);
    // Same reasoning extends to an in-progress archive/reactivate confirm and the archived-view
    // toggle itself — a new factory means an entirely different article list, so returning to
    // the default (active) view avoids showing a stale "archived" list from the last factory.
    setConfirmTarget(null);
    setActionError(null);
    setShowArchived(false);
  }

  function handleStartEdit(product) {
    setEditingProduct(product);
    // Pre-filled with the row's current prices (requirement 5.10) — null (pending) becomes an
    // empty field to type into, not "0", which would read as a real zero price if left untouched.
    setCostPrice(product.costPrice != null ? String(product.costPrice) : '');
    setSellingPrice(product.sellingPrice != null ? String(product.sellingPrice) : '');
    setPin('');
    setSubmitError(null);
    setAttemptsRemaining(null);
  }

  function handleCancelEdit() {
    setEditingProduct(null);
    setPin('');
    setSubmitError(null);
    setAttemptsRemaining(null);
  }

  async function handleSubmitEdit(event) {
    event.preventDefault();
    setSubmitError(null);
    setAttemptsRemaining(null);

    const parsedCost = Number(costPrice);
    const parsedSelling = Number(sellingPrice);
    if (!costPrice || !parsedCost || parsedCost <= 0) {
      setSubmitError('Enter a valid cost price.');
      return;
    }
    if (!sellingPrice || !parsedSelling || parsedSelling <= 0) {
      setSubmitError('Enter a valid selling price.');
      return;
    }
    if (!pin) {
      setSubmitError('Enter your PIN.');
      return;
    }

    setSubmitting(true);
    try {
      await updateProduct(editingProduct.id, { costPrice: parsedCost, sellingPrice: parsedSelling, pin });
      setSuccessMessage(`${editingProduct.articleNo} — ${editingProduct.name} updated.`);
      setEditingProduct(null);
      setPin('');
      // Re-fetch so the table reflects the edit just made, rather than showing prices that are
      // now stale by exactly the values just saved.
      setProductsStatus('loading');
      const fresh = await listProducts({ factoryId });
      setProducts(fresh);
      setProductsStatus('loaded');
    } catch (err) {
      // INVALID_PIN carries attemptsRemaining as a sibling field (see client.js's ApiError.extra)
      // — surfacing it here is the whole reason that field exists, for a lockout-prone action.
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setAttemptsRemaining(err.extra.attemptsRemaining);
      }
      setSubmitError(err.message);
      // Never leave a wrong PIN sitting in the field for a retry, same reasoning already
      // applied to Factory Payables and Set PIN.
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  // Opens the archive/reactivate confirm (requirement 4: a plain ConfirmModal, no PIN — this
  // isn't a price action). Kept as its own handler pair, deliberately not touching
  // handleStartEdit/handleSubmitEdit above.
  //
  // Archiving now checks the article's REAL stock first (2026-08-28) so the dialog can name the
  // actual quantity about to be hidden from the daily pickers. Checked live, at the moment the
  // button is pressed, rather than read from anything already in state: this screen is a pricing
  // screen that can sit open for a long time while stock moves underneath it, and a warning that
  // names a stale quantity is worse than one that names none — it reads as authoritative while
  // being wrong. Reactivating needs no check; it hides nothing.
  function handleStartArchiveAction(product, action) {
    setActionError(null);

    if (action !== 'archive') {
      setConfirmTarget({ product, action, stockStatus: 'loaded', stockSets: 0, stockRows: [] });
      return;
    }

    // 'loading' is its own state, and the confirm button stays disabled while it holds — the
    // whole point is that nobody can archive a stocked article before the warning has had a
    // chance to appear. A bare boolean would make "not checked yet" and "checked, found zero"
    // the same value, which is exactly the window where the simple no-stock wording would show
    // for an article that actually has stock.
    setConfirmTarget({ product, action, stockStatus: 'loading', stockSets: null, stockRows: [] });

    // Scoped by articleNo to keep the request small, then narrowed by productId: the backend's
    // articleNo filter is a case-insensitive CONTAINS match, and article numbers are only unique
    // per Factory anyway (CLAUDE.md), so the returned rows can legitimately include other
    // articles and other factories. Matching on productId is the only safe narrowing.
    listStock({ articleNo: product.articleNo })
      .then((rows) => {
        const mine = rows.filter((r) => r.productId === product.id);
        const totalSets = mine.reduce((sum, r) => sum + r.qtySets, 0);
        setConfirmTarget((prev) =>
          // Guard against a resolved fetch landing after the dialog was cancelled or swapped to
          // a different article — without it, a slow response could repopulate a closed dialog.
          prev && prev.product.id === product.id && prev.action === 'archive'
            ? { ...prev, stockStatus: 'loaded', stockSets: totalSets, stockRows: mine }
            : prev
        );
      })
      .catch(() => {
        setConfirmTarget((prev) =>
          prev && prev.product.id === product.id && prev.action === 'archive'
            ? { ...prev, stockStatus: 'error', stockSets: null, stockRows: [] }
            : prev
        );
      });
  }

  // The dialog body for an archive, built from whatever the stock check currently knows. Split
  // out because there are four genuinely different things to say and inlining that much branching
  // into JSX makes it hard to see that the zero-stock case is still the original wording,
  // unchanged, exactly as required.
  function archiveConfirmBody(target) {
    const { product, stockStatus, stockSets, stockRows } = target;
    const label = `${product.articleNo} — ${product.name}`;

    if (stockStatus === 'loading') return `Checking current stock for ${label}…`;

    if (stockStatus === 'error') {
      return `Could not check current stock for ${label}. It may still be holding stock — archiving hides it from Article Pricing and New Order, but never deletes anything, and its stock would still count towards stock value and stay visible under Live Stock's archived section.`;
    }

    if (stockSets > 0) {
      // Name the real quantity, and say where it is. "8 sets" alone invites the reply "where?",
      // and this is the one moment the answer is genuinely needed.
      const locations = [...new Set(stockRows.map((r) => r.locationName))].sort();
      const where = locations.length === 1 ? locations[0] : locations.join(' and ');
      return `${label} still has ${stockSets} set${stockSets === 1 ? '' : 's'} in stock at ${where}. Archiving does NOT remove that stock — it stays real, still counts towards stock value, and stays visible under Live Stock's archived section. It only hides the article from Article Pricing and New Order, along with ALL of its colours together. It can be reactivated anytime.`;
    }

    // Genuinely zero stock — the original wording, unchanged.
    return `${label} will be hidden from Article Pricing and New Order, along with ALL of its colours together — archiving isn't done per colour. Every past receipt and transaction stays fully intact, and it can be reactivated anytime.`;
  }

  async function handleConfirmArchiveAction() {
    if (!confirmTarget) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      const { product, action } = confirmTarget;
      const call = action === 'archive' ? deactivateProduct : reactivateProduct;
      await call(product.id);
      setConfirmTarget(null);
      // Re-fetch so the table reflects the real, current state — never patch local state
      // optimistically, same discipline used everywhere else in this app (Factory Payables,
      // Manage Users).
      setProductsStatus('loading');
      const fresh = await listProducts({ factoryId });
      setProducts(fresh);
      setProductsStatus('loaded');
    } catch (err) {
      setActionError(err.message);
      setConfirmTarget(null);
    } finally {
      setActionInFlight(false);
    }
  }

  // Which subset of the fetched list is on screen — active articles by default, archived ones
  // when the toggle is on (requirement 3). Derived here rather than re-fetched, since the
  // unfiltered list already has both.
  const visibleProducts = products.filter((p) => (showArchived ? !p.isActive : p.isActive));

  // Pending rows sort first (requirement 5.10) — this screen is the direct fix for articles
  // stuck pending after Receive Stock, so surfacing exactly those rows first is the whole point,
  // not a cosmetic sort choice. Ties (both pending, or both priced) fall back to articleNo so
  // the table has a stable, predictable order rather than whatever order the API happened to
  // return.
  const sortedProducts = [...visibleProducts].sort((a, b) => {
    const aPending = isPending(a);
    const bPending = isPending(b);
    if (aPending !== bPending) return aPending ? -1 : 1;
    return a.articleNo.localeCompare(b.articleNo);
  });

  const showTable = factoryId && productsStatus === 'loaded' && !productsError;

  return (
    <div className="page">
      {/* tone="tile-gold" (2026-08-27) matches Home's Article Pricing tile exactly, per Aadi's
          confirmed tap-a-tile/land-on-that-colour continuity — was unset (ScreenHeader's own
          default, accent-blue), so this is a genuinely new header colour, not a repoint of an
          existing one. Flagged, not silently touched: this page's own "Pending" price badges and
          its PIN-setup banner (below) still genuinely mean warning and still use --warning-*
          amber — gold and warning already sit only ~6° apart by hue (see the same-day tile-palette
          work in LEARNING_LOG.md), so this is the closest-reading collision of the four found this
          task, reported to Aadi rather than decided here. */}
      <ScreenHeader icon={<TagIcon size={20} />} tone="tile-gold" title="Article Pricing" />

      {factoriesError && (
        <p className="error-banner" role="alert">
          Could not load factories: {factoriesError}
        </p>
      )}

      <label className="field">
        <span className="field-label">Factory</span>
        <select
          value={factoryId}
          onChange={(e) => handleFactoryChange(e.target.value)}
          disabled={factoriesStatus !== 'loaded' || submitting}
        >
          <option value="">{factoriesStatus !== 'loaded' ? 'Loading…' : 'Select a factory'}</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      {successMessage && (
        <div className="result-banner result-banner-success">
          <p>{successMessage}</p>
          <button type="button" className="link-button" onClick={() => setSuccessMessage(null)}>
            OK
          </button>
        </div>
      )}

      {!factoryId && <p className="muted centered-empty-state">Select a factory to see its articles.</p>}

      {factoryId && productsStatus !== 'loaded' && <p className="muted centered-empty-state">Loading…</p>}

      {factoryId && productsStatus === 'loaded' && productsError && (
        <p className="error-banner" role="alert">
          Could not load articles: {productsError}
        </p>
      )}

      {actionError && (
        <p className="error-banner" role="alert">
          {actionError}
        </p>
      )}

      {showTable && (
        <>
          {/* Off by default — this screen's primary job is pricing active articles (rule 85's
              "hidden from daily pickers by default" convention). Switching it changes which
              subset of the same already-fetched list is shown, and swaps each row's actions
              from Edit/Archive to Reactivate (requirement 3). */}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>

          {sortedProducts.length === 0 ? (
            <p className="muted centered-empty-state">
              {showArchived ? 'No archived articles for this factory.' : 'This factory has no articles yet.'}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="pricing-table">
                <thead>
                  <tr>
                    <th className="pricing-table-sno">S.No.</th>
                    <th>Name</th>
                    <th>Article No</th>
                    <th className="pricing-table-num">Cost Price</th>
                    <th className="pricing-table-num">Selling Price</th>
                    <th className="pricing-table-num">Margin</th>
                    <th className="pricing-table-action">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((product, index) => {
                    const pending = isPending(product);
                    return (
                      <tr key={product.id}>
                        <td className="pricing-table-sno">{index + 1}</td>
                        <td>{product.name}</td>
                        <td>{product.articleNo}</td>
                        {pending ? (
                          <>
                            <td className="pricing-table-num">
                              <span className="badge badge-warning">Pending</span>
                            </td>
                            <td className="pricing-table-num">
                              <span className="badge badge-warning">Pending</span>
                            </td>
                            <td className="pricing-table-num">
                              <span className="badge badge-warning">Pending</span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="pricing-table-num">{formatCurrency(product.costPrice)}</td>
                            <td className="pricing-table-num">{formatCurrency(product.sellingPrice)}</td>
                            {/* costPrice/sellingPrice are raw Prisma Decimals — arrive as
                                STRINGS ("250.5"), not numbers — Number() both before
                                subtracting, never string-concatenate them. */}
                            <td className="pricing-table-num">
                              {formatCurrency(Number(product.sellingPrice) - Number(product.costPrice))}
                            </td>
                          </>
                        )}
                        <td className="pricing-table-action">
                          {showArchived ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => handleStartArchiveAction(product, 'reactivate')}
                              disabled={actionInFlight}
                            >
                              Reactivate
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => handleStartEdit(product)}
                                disabled={!user.hasPinSet || actionInFlight || (editingProduct && editingProduct.id === product.id)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="link-button danger-text"
                                onClick={() => handleStartArchiveAction(product, 'archive')}
                                disabled={actionInFlight || !!editingProduct}
                              >
                                Archive
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!editingProduct && !user.hasPinSet && (
            <Link to="/set-pin" className="prompt-banner prompt-banner-warning">
              <KeyIcon size={18} />
              <span>Set your price-edit PIN to edit article prices.</span>
            </Link>
          )}

          {editingProduct && (
            <div className="card">
              <h2 className="card-title">
                Edit price — {editingProduct.articleNo} · {editingProduct.name}
              </h2>
              {/* Same lightweight inline PIN prompt as Factory Payables' Record Payment (§5.8),
                  not a modal — the PIN field IS the confirmation step. Second real user of that
                  pattern, per 5.10. */}
              <form onSubmit={handleSubmitEdit}>
                <label className="field">
                  <span className="field-label">Cost Price</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field-label">Selling Price</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field-label">Your PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                    required
                  />
                </label>

                {submitError && (
                  <p className="error-banner" role="alert">
                    {submitError}
                    {attemptsRemaining != null &&
                      ` (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining)`}
                  </p>
                )}

                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save price'}
                </button>
                <button type="button" className="btn-secondary" onClick={handleCancelEdit} disabled={submitting}>
                  Cancel
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {/* Plain confirm, no PIN (requirement 4) — archiving/reactivating isn't a price action.
          Body copy is explicit that this is a whole-article action, not per-colour (requirement
          5) — the one thing about this action most likely to be misread at a glance. */}
      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.action === 'archive' ? 'Archive this article?' : 'Reactivate this article?'}
        body={
          confirmTarget?.action === 'archive'
            ? archiveConfirmBody(confirmTarget)
            : `${confirmTarget?.product.articleNo} — ${confirmTarget?.product.name} (and all of its colours) will be visible again in Article Pricing and available to pick in New Order.`
        }
        confirmLabel={
          actionInFlight
            ? 'Working…'
            : confirmTarget?.action === 'archive'
              ? confirmTarget?.stockStatus === 'loading'
                ? 'Checking stock…'
                : 'Archive'
              : 'Reactivate'
        }
        tone={confirmTarget?.action === 'archive' ? 'danger' : 'success'}
        // Disabled until the stock check settles. This is the safety property the whole check
        // exists for: without it, a fast tap could confirm an archive during the window where the
        // dialog hasn't yet been able to say the article is holding stock.
        confirmDisabled={actionInFlight || confirmTarget?.stockStatus === 'loading'}
        onConfirm={handleConfirmArchiveAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
