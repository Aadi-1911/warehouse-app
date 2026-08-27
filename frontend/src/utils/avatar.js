// Same initials derivation the Owner Dashboard's Parties page and DashboardLayout's own nav-rail
// tile already use (both still keep their own separate two-line copy — this was originally added
// here as a third caller for History's own avatar-circle, added 2026-08-26). Left in place,
// exported and untouched, on Aadi's own explicit instruction even though History no longer calls
// it as of the very next change the same day: the initials-circle it once fed was replaced by the
// full-name badge below, but this function itself is generic and harmless to keep — deleting it
// would be an unrelated cleanup this task didn't ask for, not a fix for anything broken.
export function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// --- Per-actor colour, History's employee name-badges only (added 2026-08-26) ---
//
// Scoped deliberately: Parties' customer avatars and the nav-rail tile stay single-coloured and
// untouched — this is a separate, additive mechanism for a different screen, not a retrofit of
// the existing one.
//
// TWO AUTOMATED ATTEMPTS WERE TRIED AND SUPERSEDED THE SAME DAY, both discarded rather than
// tuned further, per Aadi's own explicit instruction not to hash or derive this algorithmically:
//   1. A 9-slot palette (this app's 5 badge-role tokens + teal/rust/lavender/indigo from the Home
//      tile grid), hashed mod 9. Measurably collided on real data almost immediately — with just
//      7 real active users, "Ram" and "Aaditya Arora" landed in the identical bucket (verified by
//      computing the hash for every real active User.id, not assumed).
//   2. A continuous hue (0-359°) instead of a 9-slot index, to make a collision rare rather than
//      likely. This resolved that specific pair, but the underlying problem — nobody chose which
//      colour reads as "Ram" vs "Aaditya Arora," a hash function did — remained: hue math can
//      still land two real people on visually-close, easily-confused shades, and there is no
//      programmatic way to guarantee the result reads as "genuinely distinct" to an actual human
//      looking at the screen, which is exactly what broke the first time.
//
// CURRENT APPROACH: a small, explicit, manually-curated map — real name -> one of this app's
// existing named colour tokens — confirmed directly by Aadi rather than computed. This is
// deliberately NOT extensible by formula: adding a fifth employee means adding a fifth line here,
// by hand, choosing a token nothing else on this list already uses. That manual step is the whole
// point — it's what a hash function structurally cannot do (know that two colours "look different
// enough" to a person), and it's why this map replaces avatarColorFor entirely rather than
// layering on top of it.
export const ACTOR_BADGE_COLORS = {
  'Aaditya Arora': { bg: 'var(--accent-bg)', text: 'var(--accent-text)' },
  'Harsh Arora': { bg: 'var(--indigo-bg)', text: 'var(--indigo-text)' },
  Ram: { bg: 'var(--teal-bg)', text: 'var(--teal-text)' },
  // Was --rust-*, until a same-day Home-tile-recolor task retired Rust outright — fixed by
  // switching to --success-*, verified against the other three actors' colours and all 8 Home
  // tile tokens. THAT fix was itself incomplete: it never checked History's OWN entry-type badges
  // (TYPE_BADGE_CLASSES, same file/row), and Success is ORDER_STATUS's colour — so a real
  // STAFF-packed order (Pack Order is STAFF-reachable) put a green entry-type badge directly next
  // to Mukesh's green actor badge on the same row, two different meanings, indistinguishable at a
  // glance. Fixed properly this time by checking the FULL conflict set at once: the other three
  // actors (Accent/Indigo/Teal), all 8 Home tile tokens, AND all 4 of History's own entry-type
  // badge colours (purple/ORDER_PLACED, success/ORDER_STATUS, warning/ORDER_ADJUSTMENT+
  // GOOD_RETURN+RECEIPT_CORRECTION+TRANSFER_CORRECTION, accent/TRANSFER+RECEIPT) — 14 conflict
  // hues in total. Against that full list, every existing unused token failed (Danger sits just
  // 4.2° from Tile Red; nothing else was even unused). A new dedicated token, --rose-*, was added
  // to index.css instead (see its own :root comment for the full reasoning) — a rose/magenta hue
  // sitting in the single largest open gap across all 14 conflicts, closest neighbour Tile Purple
  // at 43.0° away, comfortably clear, and a colour family nothing else in this app uses at all.
  'Mukesh Kumar Yadav': { bg: 'var(--rose-bg)', text: 'var(--rose-text)' },
};

// A neutral, clearly-muted grey — reusing this app's own existing --section-fill/--text-secondary
// tokens (the same pair Home's placeholder tiles and empty-state text already use elsewhere), not
// one of the four assigned colours above. A new hire or a leftover dev/test account (this
// codebase has plenty — "Test Owner," "testing1," probe accounts) is real and must render
// something, but rendering it as if it were one of the four specifically-chosen people would be
// actively misleading, not just imprecise, so unmapped names get their own deliberately-different
// look instead.
const FALLBACK_BADGE_COLOR = { bg: 'var(--section-fill)', text: 'var(--text-secondary)' };

// Keyed by NAME, not actorId, even though the previous task established id as the more correct
// key (two different real people could in theory share a name). This is a deliberate exception:
// Aadi's confirmed list above was given, and verified, as names — hardcoding four opaque database
// cuids here instead would be less legible to whoever reads this file next, more fragile (an id
// changes if that account is ever recreated; a person's actual name does not), and solves a
// collision that hasn't happened, at the cost of a mapping nobody could review by eye. If it ever
// does happen for a real, currently-unmapped person, they fall through to the neutral badge below
// rather than silently borrowing an assigned colour — same fail-closed shape rule 104's own
// backstop filter already uses elsewhere in this codebase.
export function actorBadgeColorFor(actorName) {
  return ACTOR_BADGE_COLORS[actorName] ?? FALLBACK_BADGE_COLOR;
}
