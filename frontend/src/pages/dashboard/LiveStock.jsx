import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import { listStock } from '../../api/stock';
import { listProducts } from '../../api/products';
import { listFactories } from '../../api/factories';
import { LOW_STOCK_THRESHOLD } from '../../utils/lowStock';
import { piecesPerSetFor } from '../../utils/piecesPerSet';

// Owner Dashboard — Live Stock (added 2026-09-02). A port of mobile's LiveStock.jsx
// (07_UI_DESIGN_BRIEF.md §5.5, rules 56-57) into the dashboard shell — same grouping, same
// fields, same archived section, same search box. Read-only, no mutations, same as mobile.
//
// This task is base-page-only: no price-range filter yet (that's a follow-up). sellingPrice is
// carried through the join anyway (see buildFactoryGroups below) so that follow-up doesn't need
// to re-plumb the fetch/join just to get a field this page already had sitting right there.
//
// Shell/loading-state conventions follow this dashboard's own established pattern (explicit
// 'idle' | 'loading' | 'loaded' status, `.dash-empty`/`.card`/`.dash-card` wrappers — see
// LowStock.jsx, which already ported this exact screen's grouping logic once before) rather than
// mobile's own `.page`/ScreenHeader/boolean-loading shell, which belongs to the phone-shaped app,
// not this desktop surface.

export default function DashboardLiveStock() {
  const [stock, setStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [factories, setFactories] = useState([]);
  // Explicit status, never a bare boolean — same reasoning as every other dashboard page: an
  // empty result must be distinguishable from "hasn't fetched yet."
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Accordion open/closed state — a Set of ids, so any number of sections can be open
  // independently at once, same convention as mobile LiveStock / dashboard Low Stock.
  const [expandedFactories, setExpandedFactories] = useState(() => new Set());
  const [expandedArticles, setExpandedArticles] = useState(() => new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    Promise.all([listStock(), listProducts(), listFactories()])
      .then(([stockList, productList, factoryList]) => {
        if (cancelled) return;
        setStock(stockList);
        setProducts(productList);
        setFactories(factoryList);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
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

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // productId is what GET /api/stock carries specifically so this join is unambiguous —
  // productArticleNo alone can't be safely matched back to one Product, since article numbers
  // are only unique per Factory, never globally.
  const productsById = new Map(products.map((p) => [p.id, p]));

  const searchText = search.trim().toLowerCase();
  const filteredStock = searchText
    ? stock.filter(
        (s) =>
          s.productArticleNo.toLowerCase().includes(searchText) ||
          s.colorName.toLowerCase().includes(searchText)
      )
    : stock;

  // Archived articles split out, not filtered away, same reasoning as mobile: an archived
  // article holding real unsold inventory is still real stock. Only rows with qtySets > 0 reach
  // the archived view — an archived article drained to zero is genuinely finished.
  const activeStock = filteredStock.filter((row) => row.productIsActive);
  const archivedStock = filteredStock.filter((row) => !row.productIsActive && row.qtySets > 0);

  // Factory -> Article -> rows, same shape as mobile LiveStock.jsx's own buildFactoryGroups.
  function buildFactoryGroups(rows) {
    const factoryGroups = new Map();
    rows.forEach((row) => {
      const product = productsById.get(row.productId);
      if (!product) return; // defensive: a stock row whose product wasn't in the fetched list

      if (!factoryGroups.has(product.factoryId)) {
        const factory = factories.find((f) => f.id === product.factoryId);
        factoryGroups.set(product.factoryId, {
          factoryId: product.factoryId,
          factoryName: factory?.name ?? 'Unknown Factory',
          articles: new Map(),
        });
      }
      const factoryGroup = factoryGroups.get(product.factoryId);

      if (!factoryGroup.articles.has(row.productId)) {
        factoryGroup.articles.set(row.productId, {
          productId: row.productId,
          articleNo: row.productArticleNo,
          productName: product.name,
          piecesPerSet: piecesPerSetFor(product),
          // sellingPrice is a Product-level field (Stock -> Bundle -> Product.sellingPrice), so
          // it's the same value for every colour/location row under this article — carried once
          // here rather than duplicated onto each row. Not rendered or filtered on in this task;
          // the follow-up price-range filter task consumes it.
          sellingPrice: row.productSellingPrice,
          rows: [],
        });
      }
      factoryGroup.articles.get(row.productId).rows.push({
        key: `${row.bundleId}-${row.locationId}`,
        colorName: row.colorName,
        locationId: row.locationId,
        locationName: row.locationName,
        qtySets: row.qtySets,
        low: row.qtySets <= LOW_STOCK_THRESHOLD,
      });
    });

    return [...factoryGroups.values()]
      .map((factory) => {
        const articles = [...factory.articles.values()]
          .map((article) => {
            const totalSets = article.rows.reduce((sum, r) => sum + r.qtySets, 0);
            const distinctLocationIds = new Set(article.rows.map((r) => r.locationId));

            // Sub-group by Location only when an article's stock actually spans more than one —
            // same call mobile LiveStock.jsx makes for the same reason.
            let locationGroups = null;
            if (distinctLocationIds.size > 1) {
              const byLocation = new Map();
              article.rows.forEach((row) => {
                if (!byLocation.has(row.locationId)) {
                  byLocation.set(row.locationId, {
                    locationId: row.locationId,
                    locationName: row.locationName,
                    rows: [],
                  });
                }
                byLocation.get(row.locationId).rows.push(row);
              });
              locationGroups = [...byLocation.values()].sort((a, b) =>
                a.locationName.localeCompare(b.locationName)
              );
            }

            return {
              ...article,
              distinctColors: new Set(article.rows.map((r) => r.colorName)).size,
              lowRowCount: article.rows.filter((r) => r.low).length,
              totalSets,
              totalPieces: totalSets * article.piecesPerSet,
              locationGroups,
            };
          })
          .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

        return {
          ...factory,
          articles,
          articleCount: articles.length,
          totalSets: articles.reduce((sum, a) => sum + a.totalSets, 0),
          totalPieces: articles.reduce((sum, a) => sum + a.totalPieces, 0),
          lowCount: articles.reduce((sum, a) => sum + a.lowRowCount, 0),
        };
      })
      .sort((a, b) => a.factoryName.localeCompare(b.factoryName));
  }

  const groupedFactories = buildFactoryGroups(activeStock);
  const archivedFactories = buildFactoryGroups(archivedStock);

  const grandTotalSets = groupedFactories.reduce((sum, f) => sum + f.totalSets, 0);
  const grandTotalPieces = groupedFactories.reduce((sum, f) => sum + f.totalPieces, 0);

  const archivedTotalSets = archivedFactories.reduce((sum, f) => sum + f.totalSets, 0);
  const archivedTotalPieces = archivedFactories.reduce((sum, f) => sum + f.totalPieces, 0);
  const archivedArticleCount = archivedFactories.reduce((sum, f) => sum + f.articleCount, 0);

  // One factory accordion, rendered identically wherever it appears — same extraction mobile
  // LiveStock.jsx makes so the active and archived lists can't drift into rendering the same
  // data two slightly different ways.
  //
  // keyPrefix namespaces the FACTORY accordion's open/closed state only, same reasoning as
  // mobile: a factory can appear in both lists at once (some articles active, some archived).
  function renderFactorySection(factory, keyPrefix) {
    const factoryKey = `${keyPrefix}${factory.factoryId}`;
    const factoryOpen = expandedFactories.has(factoryKey);
    return (
      <div key={factoryKey} className="card accordion-section">
        <button
          type="button"
          className="accordion-header"
          onClick={() => toggleFactory(factoryKey)}
          aria-expanded={factoryOpen}
        >
          <div className="accordion-header-text">
            <div className="accordion-title">{factory.factoryName}</div>
            <div className="muted accordion-subtitle">
              {factory.articleCount} article{factory.articleCount === 1 ? '' : 's'} ·{' '}
              {factory.totalSets} sets · {factory.totalPieces} pieces
              {factory.lowCount > 0 && (
                <span className="badge badge-danger accordion-low-badge">
                  {factory.lowCount} low
                </span>
              )}
            </div>
          </div>
          <ChevronIcon className={factoryOpen ? 'chevron chevron-open' : 'chevron'} />
        </button>

        {factoryOpen && (
          <div className="accordion-body">
            <div className="dash-card">
              {factory.articles.map((article) => {
                const articleOpen = expandedArticles.has(article.productId);
                return (
                  <div key={article.productId} className="accordion-section nested">
                    <button
                      type="button"
                      className="accordion-header nested"
                      onClick={() => toggleArticle(article.productId)}
                      aria-expanded={articleOpen}
                    >
                      <div className="accordion-header-text">
                        <div className="accordion-title-sm">
                          {article.articleNo}
                          <span className="muted"> — {article.productName}</span>
                        </div>
                        <div className="accordion-subtitle">
                          <span className="badge badge-accent">
                            {article.distinctColors} colour{article.distinctColors === 1 ? '' : 's'}
                          </span>
                          {article.lowRowCount > 0 && (
                            <span className="badge badge-danger accordion-low-badge">Low</span>
                          )}
                        </div>
                      </div>
                      <ChevronIcon className={articleOpen ? 'chevron chevron-open' : 'chevron'} />
                    </button>

                    {articleOpen && (
                      <div className="accordion-body nested">
                        {article.locationGroups ? (
                          article.locationGroups.map((group) => (
                            <div key={group.locationId} className="location-subgroup">
                              <div className="location-subgroup-header">{group.locationName}</div>
                              {group.rows.map((row) => (
                                <div key={row.key} className="stock-row">
                                  <span className="stock-row-color">{row.colorName}</span>
                                  <span className="stock-row-qty">{row.qtySets} sets</span>
                                  {row.low && <span className="badge badge-danger">Low</span>}
                                </div>
                              ))}
                            </div>
                          ))
                        ) : (
                          article.rows.map((row) => (
                            <div key={row.key} className="stock-row">
                              <span className="stock-row-color">{row.colorName}</span>
                              <span className="muted">{row.locationName}</span>
                              <span className="stock-row-qty">{row.qtySets} sets</span>
                              {row.low && <span className="badge badge-danger">Low</span>}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status !== 'loaded') {
    return (
      <>
        {error && (
          <p className="error-banner" role="alert">
            Could not load stock: {error}
          </p>
        )}
        {!error && <p className="muted dash-empty">Loading…</p>}
      </>
    );
  }

  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          Could not refresh stock: {error}
        </p>
      )}

      <div className="stat-row">
        <div className="stat-card">
          <span className="stat-value">{grandTotalSets}</span>
          <span className="stat-label">Total sets</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{grandTotalPieces}</span>
          <span className="stat-label">Total pieces</span>
        </div>
      </div>

      <label className="field">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search article or colour"
        />
      </label>

      {/* The archived section is a real result, so an empty ACTIVE list isn't an empty page —
          same reasoning mobile LiveStock.jsx gives for this exact check. */}
      {groupedFactories.length === 0 && archivedFactories.length === 0 ? (
        <p className="muted centered-empty-state">
          {stock.length === 0 ? 'No stock recorded yet.' : 'No results match your search.'}
        </p>
      ) : (
        groupedFactories.map((factory) => renderFactorySection(factory, ''))
      )}

      {archivedFactories.length > 0 && (
        <div className="card accordion-section">
          <button
            type="button"
            className="accordion-header"
            onClick={() => setArchivedOpen((prev) => !prev)}
            aria-expanded={archivedOpen}
          >
            <div className="accordion-header-text">
              <div className="accordion-title">
                Archived articles
                <span className="badge badge-danger accordion-low-badge">Archived</span>
              </div>
              <div className="muted accordion-subtitle">
                {archivedArticleCount} article{archivedArticleCount === 1 ? '' : 's'} still
                holding stock · {archivedTotalSets} sets · {archivedTotalPieces} pieces
              </div>
            </div>
            <ChevronIcon className={archivedOpen ? 'chevron chevron-open' : 'chevron'} />
          </button>

          {archivedOpen && (
            <div className="accordion-body">
              <p className="muted hint-text">
                These articles are archived, so they no longer appear in the list above. Their
                stock is still real and still counts towards stock value — reactivate an article
                from Article Pricing to use it again.
              </p>
              {archivedFactories.map((factory) => renderFactorySection(factory, 'archived:'))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
