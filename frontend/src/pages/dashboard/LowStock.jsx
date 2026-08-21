import { useEffect, useState } from 'react';
import { ChevronIcon } from '../../components/icons';
import { listStock } from '../../api/stock';
import { LOW_STOCK_THRESHOLD } from '../../utils/lowStock';

// Owner Dashboard — Low Stock (07_UI_DESIGN_BRIEF.md §8's "Low Stock page" section, §5.7, rule 56).
//
// §8 describes this as "a full, untruncated version of the Overview widget" — but that widget was
// never built (Overview's three "extras" widgets, including this one, were explicitly out of
// scope for that task), and the staff-facing §5.7 "Low Stock List" screen this page is also meant
// to match was never built either: no dedicated file/route/Home entry exists for it, and
// LiveStock.jsx's own comment (near its grand-total calc) says as much — "a dedicated Low Stock
// List screen, §5.7, is the place for a global low-stock view; this screen's structure is
// factory-first by design." So this is a fresh build, not a reuse of an existing screen, using:
// the exact empty-state copy from §7's Round 7 Refinements, the "no severity tiers, single ≤2
// flag, never a fully-tinted row" rule (rule 56, same wording LiveStock.jsx's own header comment
// uses), and LiveStock's factory-first grouping convention, which LiveStock's own comment already
// names as this exact screen's job.
//
// GET /api/stock (via listStock(), the same call LiveStock/Transfer already use) already returns
// factoryId/factoryName directly on every row — added originally so Transfer could group without
// a second fetch (see api/stock.js's own comment) — so unlike LiveStock.jsx, this page needs no
// listProducts()/listFactories() join at all: every field this page renders (factory, article no,
// colour, location, qty) is already on the stock row.
//
// Restructured 2026-08-21: factory -> article accordion, matching Live Stock/Pack Order/Bill
// Order's shared nested-accordion convention (.accordion-section.nested etc, see index.css) —
// the flat per-factory row list got hard to scan as low-stock rows accumulated. Factory heading
// stays a plain, non-collapsible heading (unchanged) since this list is already filtered down to
// just the low rows and a factory rarely has more than a handful of low articles; ARTICLE is the
// level that now collapses, since one article can carry several colour/location rows. The same
// article+colour pair can be low at more than one Location independently (e.g. article 6023's
// colour Mouse is low at both Gurgaon and Delhi in the real dev data) — each such row is already
// keyed by bundleId+locationId below, so it naturally gets its own row within the article group
// rather than being merged.
//
// Every row on this page is low by construction (already filtered), so a per-article "Low" flag
// badge would just be true 100% of the time and say nothing — unlike Live Stock, where most
// articles AREN'T low and the flag is genuinely informative. So the collapsed article header
// instead surfaces the real figures: how many colours are low, and the combined low-set total
// across them — the same "show the actual number, not a redundant flag" call the per-row badge
// already makes, and the same shape as Bill Order's own per-article running total.

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function LowStock() {
  const [stock, setStock] = useState([]);
  // Explicit status, never a bare boolean — same reasoning as every other dashboard page: an
  // empty (no low stock) result must be distinguishable from "hasn't fetched yet."
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  // Article-level accordion state — a Set of productIds, so any number of articles (across any
  // number of factories) can be open independently at once, same convention as Live Stock/Pack
  // Order/Bill Order's own expandedArticles state.
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

  // Rule 56's ≤2 threshold, same shared constant LiveStock/New Order/Pack Order already import —
  // never redefined here.
  const lowRows = stock.filter((row) => row.qtySets <= LOW_STOCK_THRESHOLD);

  // Factory -> Article -> rows, matching LiveStock's own convention (§5.5) — the one LiveStock's
  // comment explicitly hands this exact global view off to. productId (not the bare articleNo
  // string) is the article-grouping key, same reasoning as LiveStock: article numbers are only
  // unique per Factory, never globally.
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
        rows: [],
      });
    }
    // Keyed by bundleId+locationId, same as before restructuring — this is exactly what keeps
    // the same article+colour low at two different Locations as two separate rows instead of
    // merging them.
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

      {/* Round 7 Refinements' exact wording, no severity tiers, no factory headers in this state —
          matched verbatim rather than a paraphrase. */}
      {groups.length === 0 ? (
        <p className="muted dash-empty">Nothing is low on stock right now.</p>
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
                        <div className="accordion-title-sm">{article.articleNo}</div>
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
                            {/* A single red badge carrying the actual figure, not just a "Low" flag —
                                rule 56's "small flag, never a fully-tinted row" still holds (the row
                                itself stays neutral), but every row here is already low by definition
                                (pre-filtered above), so the flag's job is better done by showing the
                                real count than by repeating a redundant "Low" label on every row. */}
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
    </>
  );
}
