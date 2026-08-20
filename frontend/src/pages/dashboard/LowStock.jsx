import { useEffect, useState } from 'react';
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

function pluralSets(n) {
  return `${n} set${n === 1 ? '' : 's'}`;
}

export default function LowStock() {
  const [stock, setStock] = useState([]);
  // Explicit status, never a bare boolean — same reasoning as every other dashboard page: an
  // empty (no low stock) result must be distinguishable from "hasn't fetched yet."
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

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

  // Rule 56's ≤2 threshold, same shared constant LiveStock/New Order/Pack Order already import —
  // never redefined here.
  const lowRows = stock.filter((row) => row.qtySets <= LOW_STOCK_THRESHOLD);

  // Factory-first grouping, matching LiveStock's own convention (§5.5) — the one LiveStock's
  // comment explicitly hands this exact global view off to.
  const factoryGroups = new Map();
  lowRows.forEach((row) => {
    if (!factoryGroups.has(row.factoryId)) {
      factoryGroups.set(row.factoryId, { factoryId: row.factoryId, factoryName: row.factoryName, rows: [] });
    }
    factoryGroups.get(row.factoryId).rows.push(row);
  });

  const groups = [...factoryGroups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort(
        (a, b) =>
          a.productArticleNo.localeCompare(b.productArticleNo) || a.colorName.localeCompare(b.colorName)
      ),
    }))
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
              {group.rows.map((row) => (
                <div key={`${row.bundleId}-${row.locationId}`} className="dash-lowstock-row">
                  <div className="dash-lowstock-row-main">
                    <span className="dash-lowstock-article">
                      {row.productArticleNo} <span className="muted">· {row.colorName}</span>
                    </span>
                    <span className="muted dash-lowstock-meta">{row.locationName}</span>
                  </div>
                  {/* A single red badge carrying the actual figure, not just a "Low" flag — rule
                      56's "small flag, never a fully-tinted row" still holds (the row itself stays
                      neutral), but every row here is already low by definition (pre-filtered
                      above), so the flag's job is better done by showing the real count than by
                      repeating a redundant "Low" label on every single row. */}
                  <span className="badge badge-danger">{pluralSets(row.qtySets)}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
