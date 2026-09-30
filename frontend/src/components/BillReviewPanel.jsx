import { formatMoney } from '../utils/money';
import { BILL_NO_MAX_LENGTH } from '../utils/billNo';
import BillFulfillmentPicker from './BillFulfillmentPicker';
import BillPriceReview from './BillPriceReview';

// The body of the Bill confirm dialog, laid out once for BOTH billing screens (docs/REVAMP_PLAN.md
// T5, 2026-09-30). BillOrderDetail.jsx (mobile) and dashboard/Orders.jsx ("Mark billed") each used
// to render their own copy of this block inside ConfirmModal; T6a/T6b switch them to this.
//
// DISPLAY ONLY. This component decides nothing and calculates nothing. Every number it shows
// (the order total, the discount/GST/rounding amounts, the total to bill) and every flag it reads
// (is the preview ready, is a PIN required) is worked out by the calling screen — with
// computeBillingAmounts and deriveBillPricing, exactly as today — and handed in as props. Every
// input's value lives in the caller's state, and every change goes back through a caller's handler.
// That's deliberate: the two screens already share their maths through utils/orderBilling.js and
// utils/billPriceOverrides.js, and a layout component that re-derived any of it would be a third
// place for the same numbers to disagree. So this file imports no billing util and no hook.
//
// Two columns from 900px up (inside ConfirmModal size="wide"), one column below it:
//   LEFT  — what leaves the building: the location picker, with its per-article stock groups and
//           the "I've confirmed this location" tick (all inside BillFulfillmentPicker).
//   RIGHT — what they pay: Order total, the price review (and its changed-prices summary), the 409
//           "prices changed while you were reviewing" note, discount, GST, Rounding, Total to bill,
//           and Bill No. when the caller supplies it.
// Below 900px the left column comes first, then the right, in the same order.
//
// NOT here, on purpose: PinPrompt, the "Enter your PIN to bill at the new prices." hint, and the
// Cancel / Bill buttons. Those belong in ConfirmModal's pinned footer (its `footer` prop) so the
// action is always on screen and the PIN field appears where the Bill button was.
//
// Text, prefixes ("Order total: ", "−", "+", "Total to bill: ", "(estimate…)"), money formats and
// classNames are copied from what both screens render today, so moving a screen onto this panel
// changes the layout and nothing else.
//
// Props:
//   pickerProps      — BillFulfillmentPicker's props, passed straight through unchanged.
//   priceReviewProps — BillPriceReview's props, passed straight through unchanged. Rendered only
//                      when previewReady, as today (no preview means no baseline prices to show).
//   hasLocation      — a fulfilment location has been chosen.
//   previewReady     — the chosen location's price preview has loaded without error.
//   previewError     — the preview's error message, or null.
//   preTaxAmount     — the Order total figure (already switched to the estimate by the caller when
//                      a price was changed). Only shown when previewReady.
//   pinRequired      — a price was changed, so Order total and Total to bill are estimates.
//   staleNote        — the 409 PRICES_CHANGED message, or null.
//   discountApplicable / onDiscountApplicableChange(checked)
//   discountPercent / onDiscountPercentChange(rawString) — the caller clamps it, as today.
//   gstApplicable / onGstApplicableChange(checked)
//   gstPercent / onGstPercentChange(rawString) — the caller clamps it, as today.
//   amounts          — computeBillingAmounts' result object, unchanged: hasDiscount,
//                      discountAmount, finalAmount, hasGst, gstAmount, roundingAdjustment,
//                      actualPayable.
//   billNo / onBillNoChange(value) / billNoDisabled — Bill No. renders only when onBillNoChange
//                      is passed (mobile today; desktop too once T6b adds it, per Owner decision Q7).

// The live billing lines always show exactly 2 decimals (utils/money.js 'paise' mode), same as the
// local formatPaise both screens define today.
function formatPaise(amount) {
  return formatMoney(amount, { mode: 'paise' });
}

export default function BillReviewPanel({
  pickerProps,
  priceReviewProps,
  hasLocation,
  previewReady,
  previewError,
  preTaxAmount,
  pinRequired,
  staleNote,
  discountApplicable,
  onDiscountApplicableChange,
  discountPercent,
  onDiscountPercentChange,
  gstApplicable,
  onGstApplicableChange,
  gstPercent,
  onGstPercentChange,
  amounts,
  billNo,
  onBillNoChange,
  billNoDisabled = false,
}) {
  return (
    <div className="bill-pricing-questions bill-review-panel">
      <div className="bill-review-panel-left">
        <BillFulfillmentPicker {...pickerProps} />
      </div>

      <div className="bill-review-panel-right">
        {/* Four states, same as both screens today: no location yet, the preview failed, it's
            loading, or it's ready. Never shows a stale or placeholder total. */}
        {!hasLocation ? (
          <p className="muted bill-pricing-pretax">Choose a fulfilment location to see the order total.</p>
        ) : previewError ? (
          <p className="error-banner" role="alert">
            Could not load prices for this location: {previewError}
          </p>
        ) : !previewReady ? (
          <p className="muted bill-pricing-pretax">Loading prices for this location…</p>
        ) : (
          <p className="muted bill-pricing-pretax">
            Order total: {formatPaise(preTaxAmount)}
            {pinRequired ? ' (estimate at your new prices)' : ''}
          </p>
        )}

        {previewReady && <BillPriceReview {...priceReviewProps} />}

        {staleNote && (
          <p className="error-banner" role="alert">
            {staleNote}
          </p>
        )}

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={discountApplicable}
            onChange={(e) => onDiscountApplicableChange(e.target.checked)}
          />
          Apply a discount?
        </label>
        {discountApplicable && (
          <div className="field bill-pricing-percent-field">
            <span className="field-label">Discount %</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={discountPercent}
              onChange={(e) => onDiscountPercentChange(e.target.value)}
              placeholder="e.g. 5"
              autoFocus
            />
          </div>
        )}
        {amounts.hasDiscount && (
          <p className="bill-pricing-line">
            −{formatPaise(amounts.discountAmount)} discount → {formatPaise(amounts.finalAmount)}
          </p>
        )}

        <label className="checkbox-field">
          <input type="checkbox" checked={gstApplicable} onChange={(e) => onGstApplicableChange(e.target.checked)} />
          Apply GST?
        </label>
        {gstApplicable && (
          <div className="field bill-pricing-percent-field">
            <span className="field-label">GST %</span>
            <input
              type="number"
              min="0"
              max="5"
              step="0.01"
              value={gstPercent}
              onChange={(e) => onGstPercentChange(e.target.value)}
              placeholder="e.g. 5"
              autoFocus
            />
          </div>
        )}
        {amounts.hasGst && <p className="bill-pricing-line">+{formatPaise(amounts.gstAmount)} GST</p>}

        {/* Rule 109's rounding, shown only when it's not 0. The exact expression both screens use
            today — a hand-built toFixed(2), deliberately NOT formatMoney (see the T1 comment on this
            line in BillOrderDetail.jsx: this is the one line where a ±₹0.01 display difference
            against the server's rounding would show). */}
        {amounts.roundingAdjustment !== 0 && (
          <p className="bill-pricing-line">
            Rounding {amounts.roundingAdjustment > 0 ? '+' : '−'}₹{Math.abs(amounts.roundingAdjustment).toFixed(2)}
          </p>
        )}

        <p className="bill-pricing-final">
          Total to bill: {formatMoney(amounts.actualPayable)}
          {pinRequired ? ' (estimate)' : ''}
        </p>

        {/* Below the total, as on mobile today: it's part of the bill, not the arithmetic, and it
            never blocks billing. */}
        {onBillNoChange && (
          <div className="field bill-no-field">
            <span className="field-label">Bill No. (optional)</span>
            <input
              type="text"
              value={billNo}
              onChange={(e) => onBillNoChange(e.target.value)}
              placeholder="e.g. INV-2291"
              maxLength={BILL_NO_MAX_LENGTH}
              disabled={billNoDisabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
