// How many individual garments are in one "set" of an article — the conversion every monetary
// and piece-count figure in this system depends on.
//
// Extracted from factoryController (2026-08-19) when the Owner Dashboard's "Pieces in stock" and
// "Stock value" KPIs became a second and third caller. It was already exported from that
// controller, which was the tell that it had outgrown living there: a controller exporting a
// domain rule for other controllers to import is a shared module wearing the wrong hat.
//
// Getting this wrong is not a cosmetic bug. LEARNING_LOG.md records it being fixed twice already
// — once in Receive Stock's receipt table, once in the factory payable sum — where treating a
// Kids article as sizes.length silently valued it at 1/4th to 1/6th of the truth.

// Mirrors frontend/src/utils/piecesPerSet.js exactly (itself consolidated 2026-08-20 from four
// separate copies in ReceiveStock.jsx/NewOrder.jsx/GoodReturns.jsx/BillOrderDetail.jsx into one
// shared frontend module). A Kids article stores exactly ONE ProductSize row (the chosen
// category), so its piece count is a fixed lookup by label, never sizes.length — that single row
// would otherwise report "1 piece per set" for an article that really holds 4, 5 or 6 (rule 50).
//
// Duplicated on the frontend rather than imported because frontend and backend are separate
// codebases with no shared-constants package; if these three categories ever change, both copies
// need updating together.
const KIDS_PIECES_BY_LABEL = { '1-5yr': 5, '6-16yr': 6, '12-18yr': 4 };

// Expects a Product with its `sizes` relation selected (at minimum `sizeLabel`). Returns 0 rather
// than throwing when a Kids article's label isn't recognised — a 0 contributes nothing to a sum,
// which is the safe direction for a money figure: it under-reports visibly rather than inventing
// value from a label nobody recognises.
function piecesPerSetFor(product) {
  if (product.isKids) {
    return KIDS_PIECES_BY_LABEL[product.sizes[0]?.sizeLabel] ?? 0;
  }
  return product.sizes.length;
}

module.exports = { KIDS_PIECES_BY_LABEL, piecesPerSetFor };
