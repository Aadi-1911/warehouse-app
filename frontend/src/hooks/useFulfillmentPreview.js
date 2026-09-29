import { useEffect, useState } from 'react';
import { getOrderFulfillmentPreview } from '../api/orders';

// Shared by both real billing entry points — BillOrderDetail.jsx (mobile) and dashboard/
// Orders.jsx's "Mark billed" modal — so there is exactly one place that fetches the fulfillment
// preview and exactly one place that decides what counts as "ready to bill." Previously each
// screen rendered BillFulfillmentPicker, which did its own preview fetch internally; that worked
// for showing per-line stock availability, but rule 113 needs the SAME preview data one level up
// too — for the priced total shown before the button, and for the `seenPrices` echo the bill
// request must send. Fetching it twice (once here, once inside the picker) would risk the two
// disagreeing about what the owner saw, which is exactly the class of bug the backend's own
// computeBilledLines sharing exists to prevent on the server side. So the picker no longer fetches
// this itself — it receives { previewStatus, preview, previewError } as props from whichever
// screen calls this hook.
//
// Explicit status, not a bare boolean — this project's own standing rule: a `false` loading flag
// can't distinguish "hasn't started" from "finished, found nothing," which would flash a false
// empty state before the first fetch even begins.
//
// `preview` is reset to `null` the INSTANT orderId or locationId changes, before the new request
// resolves — deliberately, not an oversight. Without this, switching from Location A to Location B
// would keep showing Location A's prices on screen for the length of one round-trip, which is
// precisely the "never bill with a previous location's prices" failure this hook exists to rule
// out structurally: a caller that gates "ready to bill" on `previewStatus === 'loaded' && preview`
// can never observe a loaded-but-stale-location preview, because there is no tick where both are
// true at once for the old location.
export function useFulfillmentPreview(orderId, locationId) {
  const [status, setStatus] = useState('idle');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  // Bumped by refetch() to force the effect below to re-run even when neither orderId nor
  // locationId actually changed — used when the owner opens the bill confirmation again (prices
  // may have moved since a previous look) and after a 409 PRICES_CHANGED response, where the
  // server has just said, in effect, "look again."
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!orderId || !locationId) {
      setStatus('idle');
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setPreview(null);
    setError(null);
    getOrderFulfillmentPreview(orderId, locationId)
      .then((data) => {
        // Guards an out-of-order response the same way BillFulfillmentPicker's own preview fetch
        // always did: a slow request for the PREVIOUS location landing after a fast one for the
        // new location must never overwrite it.
        if (cancelled) return;
        setPreview(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, locationId, nonce]);

  return { status, preview, error, refetch: () => setNonce((n) => n + 1) };
}
