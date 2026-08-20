// How many individual garments are in one "set" of an article — the conversion every monetary
// and piece-count figure in this system depends on.
//
// Mirrors the backend's utils/piecesPerSet.js exactly. Duplicated here rather than imported
// because frontend and backend are separate codebases with no shared-constants package; if these
// three categories ever change, both copies need updating together.
//
// Getting this wrong is not a cosmetic bug. LEARNING_LOG.md records it being fixed twice already
// — once in Receive Stock's receipt table, once in the factory payable sum — where treating a
// Kids article as sizes.length silently valued it at 1/4th to 1/6th of the truth. Consolidated
// here 2026-08-20 after ReceiveStock.jsx, NewOrder.jsx, GoodReturns.jsx and BillOrderDetail.jsx
// each carried their own copy of this same lookup.

// A Kids article stores exactly ONE ProductSize row (the chosen category), so its piece count is
// a fixed lookup by label, never sizes.length — that single row would otherwise report "1 piece
// per set" for an article that really holds 4, 5 or 6 (rule 50).
export const KIDS_PIECES_BY_LABEL = { '1-5yr': 5, '6-16yr': 6, '12-18yr': 4 };

// Expects a product-shaped object with `isKids` and a `sizes` array of `{ sizeLabel }` (at
// minimum). Returns 0 rather than throwing when a Kids article's label isn't recognised — a 0
// contributes nothing to a sum, which is the safe direction for a money figure: it under-reports
// visibly rather than inventing value from a label nobody recognises.
export function piecesPerSetFor(product) {
  if (product.isKids) {
    return KIDS_PIECES_BY_LABEL[product.sizes[0]?.sizeLabel] ?? 0;
  }
  return product.sizes.length;
}
