import { useEffect, useState } from 'react';
import { listLocations } from '../api/locations';
import { getOrderFulfillmentPreview } from '../api/orders';

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

// The toggle's short labels. Keyed on the location's real NAME rather than a hardcoded id, so
// nothing here breaks if the database is reseeded — and the fallback is the full name, so a third
// location appearing later renders correctly with no code change (it just won't be abbreviated).
const SHORT_LABELS = { Gurgaon: 'GGN' };
const DEFAULT_LOCATION_NAME = 'Gurgaon';

export default function BillFulfillmentPicker({ orderId, locationId, onLocationChange, confirmed, onConfirmedChange }) {
  // Explicit status rather than a bare boolean, per this project's own standing rule: a `false`
  // loading flag is indistinguishable from "loaded, found nothing," which would flash a false
  // empty state before the first fetch has even started.
  const [locationsStatus, setLocationsStatus] = useState('idle');
  const [locations, setLocations] = useState([]);
  const [locationsError, setLocationsError] = useState(null);

  const [previewStatus, setPreviewStatus] = useState('idle');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);

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

  // Re-runs on every location change — that live update is the whole point of the toggle: the
  // owner flips GGN→Delhi and immediately sees whether Delhi can actually cover this order.
  useEffect(() => {
    if (!orderId || !locationId) return;
    let cancelled = false;
    setPreviewStatus('loading');
    setPreviewError(null);
    getOrderFulfillmentPreview(orderId, locationId)
      .then((data) => {
        // Guards against an out-of-order response overwriting a newer one when the toggle is
        // flipped twice quickly — without this, a slow first request can land after a fast second
        // and show the WRONG location's availability under the newly-selected label.
        if (cancelled) return;
        setPreview(data);
        setPreviewStatus('loaded');
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewError(err.message);
        setPreviewStatus('loaded');
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, locationId]);

  const shortLabel = (name) => SHORT_LABELS[name] ?? name;

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
              onClick={() => onLocationChange(loc.id)}
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
              <ul className="bill-fulfillment-lines">
                {preview.lines.map((l) => (
                  <li
                    key={l.lineItemId}
                    className={`bill-fulfillment-line${l.sufficient ? '' : ' bill-fulfillment-line-short'}`}
                  >
                    <span className="bill-fulfillment-line-name">
                      {l.articleNo ? `${l.articleNo} — ` : ''}
                      {l.productName}
                      {l.colorName ? ` · ${l.colorName}` : ''}
                    </span>
                    <span className="bill-fulfillment-line-qty">
                      need {l.needed} · here {l.available}
                      {l.sufficient ? '' : ' — short'}
                    </span>
                  </li>
                ))}
              </ul>
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
