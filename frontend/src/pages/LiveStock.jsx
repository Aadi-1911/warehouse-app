import { useEffect, useState } from 'react';
import { ListIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listStock } from '../api/stock';
import { listProducts } from '../api/products';
import { listFactories } from '../api/factories';

// Live Stock View — 07_UI_DESIGN_BRIEF.md §5.5 / §6 Round 6-7 refinements / 05_BUSINESS_RULES.md
// rules 56-57. Read-only: no mutations happen here, only GET requests.
//
// Rule 56: ≤2 sets = a small red flag/badge, never a fully-tinted row (kept subtle throughout).
const LOW_STOCK_THRESHOLD = 2;

export default function LiveStock() {
  const [stock, setStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Accordion open/closed state — a Set of ids, so any number of sections can be open
  // independently at once ("Multiple groups can be open independently," §3.2). Both levels
  // start collapsed, matching the established accordion convention elsewhere in this app.
  const [expandedFactories, setExpandedFactories] = useState(new Set());
  const [expandedArticles, setExpandedArticles] = useState(new Set());

  useEffect(() => {
    let cancelled = false;

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
        if (!cancelled) setLoading(false);
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

  // productId is what GET /api/stock now carries specifically so this join is unambiguous —
  // productArticleNo alone can't be safely matched back to one Product, since article numbers
  // are only unique per Factory, never globally (see stockController.js's own comment on this).
  const productsById = new Map(products.map((p) => [p.id, p]));

  const searchText = search.trim().toLowerCase();
  const filteredStock = searchText
    ? stock.filter(
        (s) =>
          s.productArticleNo.toLowerCase().includes(searchText) ||
          s.colorName.toLowerCase().includes(searchText)
      )
    : stock;

  // Factory (outer) -> Article (nested) -> rows (rule 57), built fresh each render from
  // already-fetched data — cheap at this app's real scale, and keeps the grouping always
  // consistent with whatever the search box currently filters to.
  const factoryGroups = new Map();
  filteredStock.forEach((row) => {
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
        piecesPerSet: product.sizes.length,
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

  const groupedFactories = [...factoryGroups.values()]
    .map((factory) => {
      const articles = [...factory.articles.values()]
        .map((article) => {
          const totalSets = article.rows.reduce((sum, r) => sum + r.qtySets, 0);
          const distinctLocationIds = new Set(article.rows.map((r) => r.locationId));

          // §5.5 — updated: only sub-group by Location when an article's stock actually spans
          // more than one Location. A single-location article has nothing to disambiguate, so
          // it stays the original flat colour list rather than growing a pointless one-item
          // sub-header. locationGroups is null in that case — the render below branches on it.
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

  // Top-level summary is deliberately just sets + pieces, per rule 57's literal wording — the
  // fuller article-count/low-stock breakdown belongs to each factory section, not repeated
  // again at the page level (a dedicated Low Stock List screen, §5.7, is the place for a
  // global low-stock view; this screen's structure is factory-first by design).
  const grandTotalSets = groupedFactories.reduce((sum, f) => sum + f.totalSets, 0);
  const grandTotalPieces = groupedFactories.reduce((sum, f) => sum + f.totalPieces, 0);

  return (
    <div className="page">
      <ScreenHeader icon={<ListIcon size={20} />} title="Live Stock" />

      {error && (
        <p className="error-banner" role="alert">
          Could not load stock: {error}
        </p>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
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

          {groupedFactories.length === 0 ? (
            <p className="muted centered-empty-state">
              {stock.length === 0 ? 'No stock recorded yet.' : 'No results match your search.'}
            </p>
          ) : (
            groupedFactories.map((factory) => {
              const factoryOpen = expandedFactories.has(factory.factoryId);
              return (
                <div key={factory.factoryId} className="card accordion-section">
                  <button
                    type="button"
                    className="accordion-header"
                    onClick={() => toggleFactory(factory.factoryId)}
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
                                {/* §5.5 — updated: sub-group by Location first when an article's stock
                                    spans more than one, so two same-colour rows distinguished only by
                                    location never sit visually adjacent. Location is now the sub-header
                                    itself, so per-row location text would just repeat it — dropped in
                                    this branch only. A single-location article has nothing to
                                    disambiguate, so locationGroups is null and it renders exactly as
                                    before: a flat list with location spelled out on each row. */}
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
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
