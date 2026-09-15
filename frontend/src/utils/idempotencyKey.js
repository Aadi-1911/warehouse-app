// Generates the client-side idempotency key that makes a retried Transfer line distinguishable
// from a genuine second transfer (rule 107). One key per staged line, generated once when the
// line is staged and never regenerated — see Transfer.jsx's handleAddSelectedForArticle.
//
// WHY THIS ISN'T JUST `crypto.randomUUID()`
//
// `crypto.randomUUID()` is gated behind a SECURE CONTEXT. In an insecure one it isn't a function
// that throws a useful error — it is simply `undefined`, so calling it throws
// "crypto.randomUUID is not a function" at the call site. Secure contexts are HTTPS origins plus
// localhost/127.0.0.1. That covers Production (Vercel is HTTPS) and ordinary desktop dev
// (http://localhost:5173), so it would be easy to conclude the bare call is safe here.
//
// It isn't, and the gap is specific to how this project is actually developed. vite.config.js
// sets `host: true` deliberately, and says why in its own comment: so the dev server is reachable
// at `http://<this machine's LAN IP>:5173` from a phone on the same network. That origin is
// plain HTTP against a raw IP — NOT a secure context — which is exactly the setup used to test
// this mobile-first PWA on a real handset. So the one scenario where the bare call breaks is
// phone testing, which is the scenario Transfer Stock most needs to be exercised in.
//
// The fallback uses crypto.getRandomValues(), which is deliberately NOT secure-context-gated
// (only randomUUID and crypto.subtle are) and has been available in every browser for over a
// decade. So the fallback is cryptographically sound, not a degraded Math.random() guess — it
// builds the same RFC 4122 version-4 UUID by hand from the same entropy source randomUUID itself
// uses. There is no third tier, because a browser without getRandomValues cannot run this app at
// all for unrelated reasons.
//
// The key never needs to be unguessable — it is only ever compared for equality against keys this
// same app generated. Uniqueness is the entire requirement, and 122 bits of randomness gives that
// with room to spare.
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // The two fixed fields that make this a valid v4 UUID rather than 16 random bytes wearing a
  // UUID's punctuation: byte 6's high nibble is the version (4), and byte 8's top two bits are
  // the RFC 4122 variant (0b10). Everything else stays random.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
