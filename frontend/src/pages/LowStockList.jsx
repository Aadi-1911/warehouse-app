import { useEffect, useState } from 'react';
import { WarningTriangleIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import { listStock } from '../api/stock';
import { LOW_STOCK_THRESHOLD } from '../utils/lowStock';

// Low Stock List — 07_UI_DESIGN_BRIEF.md §5.7 ("a dedicated aggregate view of every article
// currently at or below the low-stock threshold, so staff/owner don't have to hunt across other
// screens for this"). Documented since Phase 2 planning but never built — the Owner Dashboard's
// own Low Stock page (dashboard/LowStock.jsx) was built first, as a fresh v1, for exactly this
// reason (see that file's own header comment).
//
// Any authenticated role (🔒), unlike the dashboard version (OWNER-only, behind the dashboard's
// own PIN lock) — this is a stock-visibility screen, same category as Live Stock itself, not a
// financial figure. GET /api/stock backs both: routes/stock.js gates it with requireAuth alone,
// no requireRole, and stockController.js's own select only ever joins bundle.product for
// {id, articleNo, name, factoryId, factory.name} plus bundle.color.name and location.name —
// costPrice/sellingPrice live on Product but are never selected here. Confirmed by reading the controller
// directly rather than assuming identical-looking screens share identical data safety: nothing
// owner-only rides along on this row shape, so reusing listStock() as-is (the same call Live
// Stock/Transfer/the dashboard's own Low Stock page already make) needs no separate endpoint and
// leaks nothing to STAFF.
//
// Grouping (factory heading, plain and non-collapsible, -> collapsible article accordion ->
// colour/location/qty rows) and the collapsed article header's "colour count + combined low-set
// total" summary are the exact same shape just built for the Owner Dashboard's Low Stock page —
// reused here via the same .dash-lowstock-*/.accordion-*.nested classes (all standalone, no
// dashboard-shell dependency) rather than reinvented, just mounted on this screen's own mobile
// ScreenHeader/page shell instead of the dashboard's layout. Every row here is low by
// construction (already filtered), so the per-row badge carries the real quantity rather than a
// redundant "Low" flag — same reasoning as the dashboard version.

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function LowStockList() {
  const [stock, setStock] = useState([]);
  // Explicit status, never a bare boolean — an empty (nothing low) result must be distinguishable
  // from "hasn't fetched yet," same convention this app uses everywhere data loads on mount.
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Article-level accordion state — a Set of productIds, so any number of articles (across any
  // number of factories) can be open independently at once.
  const [expandedArticles, setExpandedArticles] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    listStock()
      .then((list) => {
        if (!cancelled) setStock(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleArticle(productId) {
    setExpandedArticles((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  // Rule 56's ≤1 threshold, the same shared constant Live Stock/New Order/Pack Order/the
  // dashboard's own Low Stock page all import — never redefined here.
  const lowRows = stock.filter((row) => row.qtySets <= LOW_STOCK_THRESHOLD);

  // Factory -> Article -> rows. productId (not the bare articleNo string) is the article-grouping
  // key — article numbers are only unique per Factory, never globally.
  const factoryGroups = new Map();
  lowRows.forEach((row) => {
    if (!factoryGroups.has(row.factoryId)) {
      factoryGroups.set(row.factoryId, {
        factoryId: row.factoryId,
        factoryName: row.factoryName,
        articles: new Map(),
      });
    }
    const factoryGroup = factoryGroups.get(row.factoryId);

    if (!factoryGroup.articles.has(row.productId)) {
      factoryGroup.articles.set(row.productId, {
        productId: row.productId,
        articleNo: row.productArticleNo,
        productName: row.productName,
        rows: [],
      });
    }
    // Keyed by bundleId+locationId — this is what keeps the same article+colour low at two
    // different Locations as two separate rows instead of merging them.
    factoryGroup.articles.get(row.productId).rows.push({
      key: `${row.bundleId}-${row.locationId}`,
      colorName: row.colorName,
      locationName: row.locationName,
      qtySets: row.qtySets,
    });
  });

  const groups = [...factoryGroups.values()]
    .map((factory) => {
      const articles = [...factory.articles.values()]
        .map((article) => {
          const rows = [...article.rows].sort(
            (a, b) => a.colorName.localeCompare(b.colorName) || a.locationName.localeCompare(b.locationName)
          );
          return {
            ...article,
            rows,
            distinctColors: new Set(rows.map((r) => r.colorName)).size,
            totalSets: rows.reduce((sum, r) => sum + r.qtySets, 0),
          };
        })
        .sort((a, b) => a.articleNo.localeCompare(b.articleNo));

      return { ...factory, articles };
    })
    .sort((a, b) => a.factoryName.localeCompare(b.factoryName));

  return (
    <div className="page">
      <ScreenHeader icon={<WarningTriangleIcon size={20} />} tone="warning" title="Low Stock" />

      {error && (
        <p className="error-banner" role="alert">
          Could not load stock: {error}
        </p>
      )}

      {status !== 'loaded' ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        // Exact wording from §7's Round 7 Refinements / the Overview widget's own spec (the same
        // empty state, "one shared rule, two surfaces") — matched verbatim, not paraphrased.
        <p className="muted centered-empty-state">Nothing is low on stock right now.</p>
      ) : (
        groups.map((group) => (
          <div key={group.factoryId} className="dash-lowstock-group">
            <div className="eyebrow dash-lowstock-group-heading">{group.factoryName}</div>
            <div className="dash-card dash-lowstock-card">
              {group.articles.map((article) => {
                const open = expandedArticles.has(article.productId);
                return (
                  <div key={article.productId} className="accordion-section nested">
                    <button
                      type="button"
                      className="accordion-header nested"
                      onClick={() => toggleArticle(article.productId)}
                      aria-expanded={open}
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
                          <span className="badge badge-danger accordion-low-badge">
                            {pluralSets(article.totalSets)} low
                          </span>
                        </div>
                      </div>
                      <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
                    </button>

                    {open && (
                      <div className="accordion-body nested">
                        {article.rows.map((row) => (
                          <div key={row.key} className="dash-lowstock-row">
                            <div className="dash-lowstock-row-main">
                              <span className="dash-lowstock-article">{row.colorName}</span>
                              <span className="muted dash-lowstock-meta">{row.locationName}</span>
                            </div>
                            {/* Real quantity, not a redundant "Low" flag — every row here is
                                already low by construction (pre-filtered above), same reasoning
                                as the dashboard version's own per-row badge. */}
                            <span className="badge badge-danger">{pluralSets(row.qtySets)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
