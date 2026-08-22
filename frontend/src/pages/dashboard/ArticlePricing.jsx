import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { KeyIcon } from '../../components/icons';
import { listFactories } from '../../api/factories';
import { listProducts, updateProduct } from '../../api/products';
import PinPrompt from '../../components/PinPrompt';

// Owner Dashboard — Article Pricing (added 2026-08-21, beyond 07_UI_DESIGN_BRIEF.md §8's
// original 5-item nav — same "append sensibly, don't renumber the existing list" precedent
// Locations already established).
//
// A genuine desktop grid, not the mobile screen ported over: mobile (pages/ArticlePricing.jsx)
// is factory-scoped (pick a Factory first, then see its articles) because on a phone that's the
// only way to keep the list short enough to be usable. A desktop owner wants the opposite — every
// article, every factory, in one sortable table, filtering by eye rather than by a forced picker.
// So this fetches unfiltered (GET /api/products with no factoryId) and adds Factory as a real,
// sortable COLUMN instead of a pre-filter.
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

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function isPending(product) {
  return product.costPrice == null || product.sellingPrice == null;
}

function getSortValue(product, key, factoryNameById) {
  switch (key) {
    case 'articleNo':
      return product.articleNo;
    case 'name':
      return product.name;
    case 'factory':
      return factoryNameById.get(product.factoryId) ?? '';
    case 'costPrice':
      return product.costPrice != null ? Number(product.costPrice) : null;
    case 'sellingPrice':
      return product.sellingPrice != null ? Number(product.sellingPrice) : null;
    case 'margin':
      return product.costPrice != null && product.sellingPrice != null
        ? Number(product.sellingPrice) - Number(product.costPrice)
        : null;
    default:
      return null;
  }
}

const COLUMNS = [
  { key: 'articleNo', label: 'Article No' },
  { key: 'name', label: 'Name' },
  { key: 'factory', label: 'Factory' },
  { key: 'costPrice', label: 'Cost Price', numeric: true },
  { key: 'sellingPrice', label: 'Selling Price', numeric: true },
  { key: 'margin', label: 'Margin', numeric: true },
];

export default function DashboardArticlePricing() {
  const { user } = useAuth();

  const [factories, setFactories] = useState([]);
  const [products, setProducts] = useState([]);
  // 'idle' | 'loading' | 'loaded' — never a bare boolean, same discipline as every other
  // mount-fetching screen in this app.
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState(null);

  const [sort, setSort] = useState({ key: null, direction: 'asc' });

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

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    Promise.all([listFactories(), listProducts()])
      .then(([factoryList, productList]) => {
        if (cancelled) return;
        setFactories(factoryList);
        setProducts(productList);
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

  function handleSort(key) {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
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

  const factoryNameById = new Map(factories.map((f) => [f.id, f.name]));

  // Active articles only — archive/reactivate is a separate concern this page doesn't manage
  // (mobile's own archive toggle isn't part of what was asked for here).
  const visibleProducts = products.filter((p) => p.isActive);

  const sortedProducts = [...visibleProducts].sort((a, b) => {
    // No column clicked yet: pending-first, then articleNo — matches mobile's own default
    // priority (this screen exists partly to fix stuck-pending articles, so surfacing them
    // first is the point, not a cosmetic tie-break). Once a real column IS clicked, that
    // explicit choice is respected literally — see below.
    if (!sort.key) {
      const aPending = isPending(a);
      const bPending = isPending(b);
      if (aPending !== bPending) return aPending ? -1 : 1;
      return a.articleNo.localeCompare(b.articleNo);
    }
    const aVal = getSortValue(a, sort.key, factoryNameById);
    const bVal = getSortValue(b, sort.key, factoryNameById);
    // Pending (null) prices always sort LAST regardless of direction — "unknown" isn't a low
    // or high number, so treating null as 0 would misplace it relative to real prices.
    const aNull = aVal == null;
    const bNull = bVal == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (aNull && bNull) return 0;
    const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
    return sort.direction === 'asc' ? cmp : -cmp;
  });

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

      <div className="dash-card">
        {sortedProducts.length === 0 ? (
          <p className="muted dash-empty">No active articles yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="dash-pricing-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className={col.numeric ? 'dash-pricing-num' : ''}>
                      <button
                        type="button"
                        className="dash-pricing-th-btn"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {sort.key === col.key && (
                          <span className="dash-pricing-sort-indicator">
                            {sort.direction === 'asc' ? ' ▲' : ' ▼'}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                  <th className="dash-pricing-action">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((product) => {
                  const pending = isPending(product);
                  const isEditing = editingId === product.id;
                  const isStaged = isEditing && !!priceDraft;
                  const factoryName = factoryNameById.get(product.factoryId) ?? '—';

                  return (
                    <Fragment key={product.id}>
                      <tr className={isEditing ? 'dash-pricing-row-editing' : ''}>
                        <td>{product.articleNo}</td>
                        <td>{product.name}</td>
                        <td>{factoryName}</td>
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
                            <td className="dash-pricing-num">{formatCurrency(priceDraft.costPrice)}</td>
                            <td className="dash-pricing-num">{formatCurrency(priceDraft.sellingPrice)}</td>
                            <td className="dash-pricing-num">
                              {formatCurrency(priceDraft.sellingPrice - priceDraft.costPrice)}
                            </td>
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
                            <td className="dash-pricing-num">{formatCurrency(product.costPrice)}</td>
                            <td className="dash-pricing-num">{formatCurrency(product.sellingPrice)}</td>
                            {/* Raw Prisma Decimals arrive as STRINGS ("250.5") — Number() both
                                before subtracting, never string-concatenate them. */}
                            <td className="dash-pricing-num">
                              {formatCurrency(Number(product.sellingPrice) - Number(product.costPrice))}
                            </td>
                          </>
                        )}
                        <td className="dash-pricing-action">
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
                          ) : (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => handleStartEdit(product)}
                              disabled={!user.hasPinSet || (editingId !== null && editingId !== product.id)}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && !isStaged && formError && (
                        <tr className="dash-pricing-error-row">
                          <td colSpan={COLUMNS.length + 1}>
                            <p className="error-banner" role="alert">
                              {formError}
                            </p>
                          </td>
                        </tr>
                      )}
                      {isStaged && (
                        <tr className="dash-pricing-pin-row">
                          <td colSpan={COLUMNS.length + 1}>
                            <p className="muted">
                              Setting cost {formatCurrency(priceDraft.costPrice)} and selling{' '}
                              {formatCurrency(priceDraft.sellingPrice)} for {product.articleNo} — {product.name}.
                              Enter your PIN to confirm.
                            </p>
                            <PinPrompt
                              submitLabel="Save price"
                              submittingLabel="Saving…"
                              autoFocus
                              onSubmit={handleConfirmEdit}
                            />
                            <button type="button" className="link-button" onClick={() => setPriceDraft(null)}>
                              Change details
                            </button>
                            <button type="button" className="link-button" onClick={handleCancelEdit}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
