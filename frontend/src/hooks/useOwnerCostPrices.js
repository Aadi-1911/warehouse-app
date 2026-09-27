import { useEffect, useState } from 'react';
import { listProducts } from '../api/products';

// costPrice per article, for rule 113's below-cost warning on the Bill confirm screens.
//
// WHY A FETCH AT ALL, AND WHY THIS ONE. Neither billing screen had a cost figure before this: the
// orders API never selects costPrice (orderController.js's own header comment states that as a
// property — Orders are a selling-price-facing feature), and the fulfillment preview deliberately
// returns none either, asserted by test-location-pricing.mjs scenario F's whole-payload scan. So the
// warning needs the products API, which is where an OWNER already legitimately reads cost.
//
// NO NEW COST EXPOSURE PATH IS CREATED BY THIS. GET /api/products adds costPrice to its select ONLY
// for an OWNER request (productController.js's productSelect(role), line 34) — a STAFF caller gets
// products with no cost field at all, so this hook would build an empty map for them rather than
// leaking anything. The `isOwner` argument is belt-and-braces on top of that server gate, not the
// gate itself: it means a STAFF session never even issues the request. Both Bill screens are
// OWNER-only at the route already (App.jsx's requireRole="OWNER" on /bill-orders/:id, and the whole
// /dashboard tree), so in practice this is always true where it's used.
//
// A FAILED OR PENDING LOOKUP NEVER BLOCKS BILLING. The warning is advisory — rule 113 is explicit
// that below cost warns and never blocks — so an error here leaves the map null and the UI simply
// shows no warning. Wiring this into the confirm button's readiness gate would turn a cosmetic
// nicety into a reason an owner can't bill, which is strictly worse than not warning.
export function useOwnerCostPrices(isOwner) {
  // Explicit status, not a bare boolean, per this project's standing rule: 'idle' has to be
  // distinguishable from 'loaded, found nothing', or the UI can't tell "no warning because cost
  // hasn't loaded" from "no warning because nothing is below cost".
  const [status, setStatus] = useState('idle');
  const [costPriceByProductId, setCostPriceByProductId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Stays 'idle' forever for a non-owner — the distinct state that means "never even asked".
    if (!isOwner) return undefined;
    let cancelled = false;
    setStatus('loading');
    listProducts()
      .then((rows) => {
        if (cancelled) return;
        // Keyed by product id, not articleNo — articleNo is unique only per Factory, so keying on it
        // would collide two factories' identically-numbered articles onto one cost.
        const map = new Map();
        for (const p of rows) {
          // A null costPrice is rule 8's "pending price" — a real state (an article received before
          // anyone priced it), not missing data. Left out of the map so it reads as "no cost known"
          // rather than as a cost of 0, which would make every price look above cost.
          if (p.costPrice != null) map.set(p.id, Number(p.costPrice));
        }
        setCostPriceByProductId(map);
        setStatus('loaded');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  return { status, costPriceByProductId, error };
}
