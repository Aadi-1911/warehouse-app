// Bill No. — the client-side half of the same input hygiene backend/src/utils/billNo.js enforces
// (added 2026-08-30). Deliberately duplicated as a constant rather than fetched from the server:
// it's a fixed defensive cap, and a `maxLength` attribute has to be known at render time.
//
// The server is still the authority — it re-trims and re-checks every value it's given, and would
// reject an over-long one with a 400 regardless of what this file says. This exists so a typist
// is stopped at the input rather than at a submit-time error, not as the enforcement itself.
//
// Keep in sync with BILL_NO_MAX_LENGTH in backend/src/utils/billNo.js. Two independent constants
// rather than one shared module because this project has no shared frontend/backend package, and
// inventing one for a single integer would be a heavier structural change than the duplication
// it removes.
export const BILL_NO_MAX_LENGTH = 50;

// Trim for display/submit. The server trims again on its own — this just keeps a stray space from
// being sent or rendered as if it were part of the reference.
export function cleanBillNo(value) {
  return typeof value === 'string' ? value.trim() : '';
}
