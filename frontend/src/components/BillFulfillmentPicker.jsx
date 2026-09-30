import { useEffect, useState, useMemo } from 'react';
import { listLocations } from '../api/locations';
import { formatMoney } from '../utils/money';

// The "which location is this order actually shipping out of?" block, shared by BOTH real billing
// entry points — BillOrderDetail.jsx (mobile) and dashboard/Orders.jsx's "Mark billed" modal —
// for the same reason utils/orderBilling.js is shared between them: two separately-written copies
// of a billing control can drift, and this one gates an irreversible stock deduction.
//
// Added 2026-09-07 alongside the backend change that made `locationId` + `locationConfirmed`
// required on PATCH /api/orders/:id/bill. Both screens MUST render this or billing 400s outright —
// there is no default location server-side, on purpose.
//
// Three jobs, in order:
//   1. Pick exactly one location (defaults to Gurgaon/GGN, freely switchable).
//   2. Show a live per-line preview from the server for the currently-selected location, so a
//      wrong-location choice is visible BEFORE the irreversible button, not as a 409 after it.
//   3. Require an explicit confirmation checkbox, which the parent uses to disable its confirm
//      button — the client half of a double-enforced guard whose server half rejects
//      `locationConfirmed !== true` regardless of what any UI does.
//
// PREVIEW FETCHING MOVED OUT (rule 113, 2026-09-25). This component used to fetch
// GET /api/orders/:id/fulfillment-preview itself. It now receives `previewStatus`/`preview`/
// `previewError` as props instead, from useFulfillmentPreview — called once by the PARENT screen,
// not once here. Rule 113 needs the identical preview data one level up too, for the priced total
// shown above this component and for the `seenPrices` echo the bill request must send; fetching it
// twice would risk the parent and this component disagreeing about what the owner was actually
// shown, which is exactly the kind of drift the backend's own shared computeBilledLines exists to
// rule out server-side. This component still owns the LOCATION list and the default-location
// selection — those are its own concern and don't need to live in the parent.

// The toggle's short labels. Keyed on the location's real NAME rather than a hardcoded id, so
// nothing here breaks if the database is reseeded — and the fallback is the full name, so a third
// location appearing later renders correctly with no code change (it just won't be abbreviated).
const SHORT_LABELS = { Gurgaon: 'GGN' };
const DEFAULT_LOCATION_NAME = 'Gurgaon';

// `orderId` is no longer a prop here — it was only ever used to key the preview fetch this
// component used to make itself, which now lives in the parent's useFulfillmentPreview call (see
// the header comment). This component receives the RESULT (previewStatus/preview/previewError),
// never the id needed to fetch it.
// `onLocationSwitched` (optional, rule 113) is called ONLY when the owner taps a location that is
// not the current one — the same single branch that clears the confirmation tick. It is deliberately
// a separate prop from `onLocationChange`, which is also fired by the default-location resolution
// below: a parent needs to distinguish "the picker settled on its default" from "the owner switched
// away", because only the second invalidates work the owner had already done (their tick, and any
// at-billing price they typed against the old location's baseline).
export default function BillFulfillmentPicker({
  locationId,
  onLocationChange,
  confirmed,
  onConfirmedChange,
  onLocationSwitched,
  previewStatus,
  preview,
  previewError,
}) {
  // Explicit status rather than a bare boolean, per this project's own standing rule: a `false`
  // loading flag is indistinguishable from "loaded, found nothing," which would flash a false
  // empty state before the first fetch has even started.
  const [locationsStatus, setLocationsStatus] = useState('idle');
  const [locations, setLocations] = useState([]);
  const [locationsError, setLocationsError] = useState(null);

  // Which article groups are expanded, keyed by group key (below). Starts empty on every mount —
  // ConfirmModal unmounts this component entirely on close (`if (!open) return null`), so a plain
  // useState here already guarantees "always starts fully collapsed" on reopen with no extra reset
  // logic needed.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    setLocationsStatus('loading');
    listLocations()
      .then((rows) => {
        // Archived locations are filtered out here because the server rejects them anyway
        // (`locationId must be a real, active location`) — offering one would be offering a
        // guaranteed 400.
        const active = rows.filter((l) => l.isActive);
        setLocations(active);
        setLocationsStatus('loaded');
        // Default to GGN, but only if the parent hasn't already got a choice — re-defaulting over
        // a real selection would silently undo the owner's own toggle on a re-render.
        if (!locationId && active.length > 0) {
          const preferred = active.find((l) => l.name === DEFAULT_LOCATION_NAME) ?? active[0];
          onLocationChange(preferred.id);
        }
      })
      .catch((err) => {
        setLocationsError(err.message);
        setLocationsStatus('loaded');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shortLabel = (name) => SHORT_LABELS[name] ?? name;

  // Groups preview.lines by article — each line is already one colour of one article (matching how
  // the flat list rendered them before), so grouping by articleNo+productName naturally groups by
  // colour underneath each article header. Keyed on both fields together, not articleNo alone,
  // since a null articleNo (no product join) would otherwise collapse every such line into one
  // group regardless of product.
  const groups = useMemo(() => {
    if (!preview) return [];
    const byKey = new Map();
    for (const l of preview.lines) {
      const key = `${l.articleNo ?? ''}::${l.productName ?? ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, { key, articleNo: l.articleNo, productName: l.productName, lines: [] });
      }
      byKey.get(key).lines.push(l);
    }
    return [...byKey.values()];
  }, [preview]);

  return (
    <div className="bill-fulfillment">
      <p className="field-label bill-fulfillment-heading">Fulfil from</p>

      {locationsStatus !== 'loaded' ? (
        <p className="muted">Loading locations…</p>
      ) : locationsError ? (
        <p className="error-banner" role="alert">
          Could not load locations: {locationsError}
        </p>
      ) : (
        <div className="bill-fulfillment-toggle" role="group" aria-label="Fulfilment location">
          {locations.map((loc) => (
            <button
              key={loc.id}
              type="button"
              className={`bill-fulfillment-option${loc.id === locationId ? ' bill-fulfillment-option-active' : ''}`}
              aria-pressed={loc.id === locationId}
              onClick={() => {
                // Switching to a DIFFERENT location invalidates any earlier tick — it was a read
                // of the OLD location, not this one. Tapping the already-selected location is a
                // no-op here on purpose, so it never clears a tick that's still valid.
                if (loc.id !== locationId) {
                  onLocationChange(loc.id);
                  onConfirmedChange(false);
                  // Rule 113: a typed at-billing price was approved against the OLD location's
                  // baseline, so it must not survive a switch either. Fired from THIS branch
                  // specifically — never from the default-location pick above (which is not a
                  // switch and has nothing to invalidate), and never from a preview re-fetch,
                  // which doesn't come through here at all.
                  onLocationSwitched?.(loc.id, loc.name);
                }
              }}
            >
              {shortLabel(loc.name)}
            </button>
          ))}
        </div>
      )}

      {/* Per-line availability at the CURRENTLY selected location. Deliberately shows every line,
          not just the failing ones — "all four lines are covered here" is the reassurance that
          makes the confirmation checkbox below a real decision rather than a reflex. */}
      {locationId && (
        <div className="bill-fulfillment-preview">
          {previewStatus !== 'loaded' ? (
            <p className="muted">Checking stock at this location…</p>
          ) : previewError ? (
            <p className="error-banner" role="alert">
              Could not check stock here: {previewError}
            </p>
          ) : preview ? (
            <>
              {!preview.canFulfill && (
                <p className="error-banner" role="alert">
                  {preview.locationName} can't cover this order — the lines below marked short don't have
                  enough stock here. Billing from here will be rejected.
                </p>
              )}
              <div className="bill-fulfillment-groups">
                {groups.map((group) => {
                  const expanded = expandedGroups.has(group.key);
                  const groupSufficient = group.lines.every((l) => l.sufficient);
                  return (
                    <div key={group.key} className="bill-fulfillment-group">
                      <button
                        type="button"
                        className="bill-fulfillment-group-header"
                        aria-expanded={expanded}
                        onClick={() => toggleGroup(group.key)}
                      >
                        <span
                          className={`bill-fulfillment-group-status${groupSufficient ? '' : ' bill-fulfillment-group-status-short'}`}
                          aria-hidden="true"
                        >
                          {groupSufficient ? '✓' : '⚠'}
                        </span>
                        <span className="bill-fulfillment-group-title">
                          {group.articleNo ? `${group.articleNo} — ` : ''}
                          {group.productName}
                          {' · '}
                          {group.lines.length} color{group.lines.length === 1 ? '' : 's'}
                        </span>
                        <span className="bill-fulfillment-group-chevron" aria-hidden="true">
                          {expanded ? '▾' : '▸'}
                        </span>
                      </button>
                      {expanded && (
                        <ul className="bill-fulfillment-lines">
                          {group.lines.map((l) => (
                            <li
                              key={l.lineItemId}
                              className={`bill-fulfillment-line${l.sufficient ? '' : ' bill-fulfillment-line-short'}`}
                            >
                              <span className="bill-fulfillment-line-name">{l.colorName ?? '—'}</span>
                              <span className="bill-fulfillment-line-qty">
                                need {l.needed} · InStock {l.available}
                                {l.sufficient ? '' : ' — short'}
                                {/* billedUnitPrice (rule 111/113) — what THIS line bills at from
                                    the currently selected location: the location's own selling
                                    override if the article is opted in and one is set, otherwise
                                    the price this line was quoted at order time. Never priceAtOrder
                                    directly — this is the same resolver billOrder() itself uses
                                    (utils/locationPricing.js), so this figure and the bill can
                                    never disagree. Absent (null) only if this preview predates the
                                    field, which cannot happen for a live server — guarded anyway so
                                    a stale cached response degrades to hiding the price rather than
                                    rendering "₹null".
                                    PER PIECE, not per set — computeBilledLines multiplies
                                    qtySetsPacked × piecesPerSet × billedUnitPrice
                                    (backend/src/utils/locationPricing.js), so this is a piece
                                    price, same as every other cost/selling price figure in the app.
                                    "(per piece)" is this codebase's own existing wording for
                                    exactly this distinction — dashboard/History.jsx's "Corrected
                                    cost price (per piece)" field label — reused here rather than
                                    inventing a second phrasing ("/set" was wrong: it implied this
                                    price was already multiplied by piecesPerSet, which it isn't). */}
                                {/* T1 (2026-09-30): utils/money.js's formatMoney(), default 'price'
                                    mode — a per-piece rate is a price, not one of the discount/GST/
                                    Order-total "paise" lines (that distinction lives one level up,
                                    in BillOrderDetail.jsx/dashboard/Orders.jsx, the only callers
                                    that also render those lines). Was a byte-identical local
                                    formatCurrency() defined in this file; see money.js's own header
                                    comment for the decimal/negative-sign bugs that fixed. */}
                                {l.billedUnitPrice != null && <> · {formatMoney(l.billedUnitPrice)} (per piece)</>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* The order's real pre-tax total from THIS location is deliberately NOT repeated
                  here — both parent screens already show it, right above this component, as
                  "Order total: …" (now sourced from this same preview.preTaxAmount rather than
                  recomputed here). One number, shown once, is the point: showing it a second time
                  in a different place invites the two copies drifting in appearance even though
                  both read the same field, and there's no reason to risk that for a figure this
                  screen's caller already displays. Deliberately NOT summed from the per-line
                  `needed` figures above either way — those are in SETS, and needed × unit price
                  would silently ignore piecesPerSet and could disagree with what billOrder()
                  actually charges (see utils/orderBillingAmounts.js's own warning against exactly
                  this "two numbers for one fact" drift). */}
            </>
          ) : null}
        </div>
      )}

      {/* The client half of the double-enforced guard. The parent disables its confirm button on
          this being false; the SERVER independently rejects locationConfirmed !== true. Neither is
          trusted to do the other's job — this one exists to make the owner stop and read the
          location above, which a server check alone can't accomplish. */}
      <label className="checkbox-field bill-fulfillment-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
        I've confirmed this is the correct fulfillment location.
      </label>
    </div>
  );
}
