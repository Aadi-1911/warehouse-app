// "Prices OK, or change?" — rule 113's at-billing price review, shared by BOTH Bill confirm screens
// (BillOrderDetail.jsx mobile, dashboard/Orders.jsx's "Mark billed" modal).
//
// Presentational only. Every derivation it renders comes from utils/billPriceOverrides.js's
// deriveBillPricing, computed once by the parent — this component decides nothing, so the two
// screens cannot show the same order two different answers. The typed values live in the PARENT's
// state rather than here, because the parent is what builds the request body and what has to clear
// them when the fulfilment location changes.
//
// Why a component and not just markup in each screen: the two screens already had independently
// written copies of the discount/GST block, which is exactly why utils/orderBilling.js exists. This
// block is considerably more intricate than those (an input per article, per-article validation, a
// below-cost warning, a change summary, an estimated total), so two copies would drift faster and
// matter more when they did — this gates a PIN on an irreversible action.
//
// LAYOUT NOTE: each article renders as stacked BLOCKS, not a flex row with the name on one side and
// the input on the other. That is deliberate. The .modal-card this sits inside caps at 300px
// (~240px usable), and a flex row of "long article name" + "price input" is precisely the shape
// that produced the colour-name-squeeze bug fixed in 40997e8 — an item with a hard minimum width
// squeezing its neighbour to nothing. Stacking sidesteps that whole class of failure rather than
// tuning around it.
export default function BillPriceReview({
  pricing,
  onOverrideChange,
  formatCurrency,
  costStatus,
  resetNote,
  disabled = false,
}) {
  return (
    <div className="bill-price-review">
      <p className="field-label bill-price-review-heading">Prices OK, or change?</p>

      {/* Shown when a real location SWITCH cleared what was typed (never on the default-location
          pick, and never on a same-location re-fetch). The owner typed prices against a different
          location's baselines; silently carrying them over would mean a figure approved for Delhi
          quietly applying to Gurgaon. */}
      {resetNote && (
        <p className="bill-price-review-reset" role="status">
          {resetNote}
        </p>
      )}

      {pricing.articles.map((article) => (
        <div key={article.productId ?? article.lines[0].lineItemId} className="bill-price-review-row">
          <p className="bill-price-review-article">
            {article.articleNo ? `${article.articleNo} — ` : ''}
            {article.productName}
          </p>

          <div className="bill-price-review-control">
            {/* The baseline, always visible even after a change is typed — "₹500 → ₹480" is the
                whole point, and an input that replaced the old figure would hide half of it. A
                RANGE (₹500–₹520) is a real case, not a display quirk: priceAtOrder is snapshotted
                per line and PATCH /:id/lines re-snapshots it, so one article's colours on one order
                genuinely can carry different baselines. One input still covers them all, because a
                change applies per ARTICLE. */}
            <span className="bill-price-review-baseline">
              {article.hasBaselineRange
                ? `${formatCurrency(article.baselineMin)}–${formatCurrency(article.baselineMax)}`
                : formatCurrency(article.baselineMin)}
            </span>

            {article.overridable ? (
              <input
                type="number"
                inputMode="decimal"
                className="bill-price-review-input"
                min="0"
                step="0.01"
                value={article.typed}
                onChange={(e) => onOverrideChange(article.productId, e.target.value)}
                placeholder="new price"
                aria-label={`New per-piece price for ${article.articleNo ?? article.productName}`}
                disabled={disabled}
              />
            ) : (
              // Cannot happen for a live order (Product is a required relation) — but an article
              // with no id cannot be named in priceOverrides, so it gets no input rather than one
              // whose value could never be sent.
              <span className="muted">not changeable</span>
            )}
          </div>

          {article.error && (
            <p className="bill-price-review-error" role="alert">
              {article.error}
            </p>
          )}

          {article.changed && !article.error && (
            <p className="bill-price-review-changed">
              This bill: {formatCurrency(article.typedValue)} per piece
              {article.hasBaselineRange ? ' (replaces both prices above)' : ''}
            </p>
          )}

          {/* Warns, never blocks (rule 113). Computed from the OWNER's own cost figure — see
              hooks/useOwnerCostPrices.js on why no cost field comes from the order or preview APIs,
              and why a STAFF session can't reach one. */}
          {article.belowCost && (
            <p className="bill-price-review-belowcost" role="alert">
              ⚠ Below cost ({formatCurrency(article.costPrice)} per piece) — allowed, but check this
              is intended.
            </p>
          )}
        </div>
      ))}

      {/* The summary rule 113 asks for: every changed article, old → new, in one place. Separate
          from the per-row "This bill:" lines above on purpose — those answer "what did I type on
          this row", this answers "what am I about to authorise with my PIN", which is the question
          the confirm step is actually asking. */}
      {pricing.changedArticles.length > 0 && (
        <div className="bill-price-review-summary">
          <p className="bill-price-review-summary-heading">
            {pricing.changedArticles.length} price{pricing.changedArticles.length === 1 ? '' : 's'} changed for
            this bill only
          </p>
          {pricing.changedArticles.map((a) => (
            <p key={a.productId} className="bill-price-review-summary-line">
              {a.articleNo ?? a.productName}:{' '}
              {a.hasBaselineRange
                ? `${formatCurrency(a.baselineMin)}–${formatCurrency(a.baselineMax)}`
                : formatCurrency(a.baselineMin)}{' '}
              → {formatCurrency(a.typedValue)}
            </p>
          ))}
          {/* Stated plainly because it is the single most consequential thing to misunderstand about
              this feature: nothing here writes a saved price. The next order for the same article
              quotes the unchanged one. */}
          <p className="muted bill-price-review-summary-note">
            Saved prices are not changed — this applies to this bill only.
          </p>
        </div>
      )}

      {/* Only surfaced while cost is still loading AND something is actually below-cost-checkable.
          A silent absence of warnings is indistinguishable from "nothing is below cost", which is
          exactly the ambiguity useOwnerCostPrices' explicit status exists to resolve. */}
      {costStatus === 'loading' && pricing.articles.length > 0 && (
        <p className="muted bill-price-review-cost-pending">Checking cost prices…</p>
      )}
    </div>
  );
}
