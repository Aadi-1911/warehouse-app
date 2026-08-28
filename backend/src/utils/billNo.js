// Bill No. — the shared normalise-and-validate step for the two independent `billNo` reference
// tags (FactoryDebit.billNo and Order.billNo), added 2026-08-30.
//
// Shared as one function purely because the same three defensive rules (trim, length cap,
// blank-means-cleared) apply identically at all four call sites — createFactoryDebit,
// updateFactoryDebit, billOrder, updateOrderBillNo. This is NOT a shared bill entity or a hint
// that the two fields are related: they remain two independent columns on two unrelated models
// (see each field's own schema comment). Nothing here computes, sums, or interprets the value —
// it's input hygiene only.
//
// Purely functional, no Prisma/Express dependency, so it's testable standalone the same way
// utils/piecesPerSet.js and utils/historyGrouping.js already are.

const BILL_NO_MAX_LENGTH = 50;

// Three genuinely different inputs, three different outcomes — collapsing any two of them would
// lose real meaning:
//   - key absent entirely       -> { provided: false }  ("don't touch this field")
//   - null / '' / whitespace    -> value null           ("clear this field")
//   - a real string             -> value trimmed        ("set it to this")
// The absent-vs-blank distinction is what lets PATCH treat "no billNo key in the body" as leave
// alone, while still allowing an owner to deliberately blank out a wrong reference tag.
function normalizeBillNo(raw) {
  if (raw === undefined) return { ok: true, provided: false };
  if (raw === null) return { ok: true, provided: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, message: 'billNo must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, provided: true, value: null };
  if (trimmed.length > BILL_NO_MAX_LENGTH) {
    return { ok: false, message: `billNo must be ${BILL_NO_MAX_LENGTH} characters or fewer` };
  }
  return { ok: true, provided: true, value: trimmed };
}

module.exports = { normalizeBillNo, BILL_NO_MAX_LENGTH };
