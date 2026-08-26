const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/history — any authenticated role (🔒). A unified, read-only feed of what's happened
// across Orders, Transfers, Good Returns, Receive Stock receipts, Transaction Corrections, and
// Transfer Corrections, newest first.
//
// Receipts and Transaction Corrections added 2026-08-21 for that feature — before that, this feed
// had no receiving source at all (verified by reading this function directly, not assumed). A
// receipt needed a place in this feed for two reasons: it's a real warehouse event same as the
// others already here, and it's the only place an OWNER can find a specific receipt to correct
// (the correction action lives on dashboard/History.jsx, so what it corrects has to be visible
// there too). The correction ACTION itself is OWNER-gated (POST /api/transaction-corrections,
// plus PIN when it touches price). Its ENTRY is not gated by entry TYPE — but as of rule 104
// below, it is gated by ACTOR, and since only an OWNER can perform a correction, a correction
// entry now reaches OWNER viewers only. That's a consequence of the actor rule, not a separate
// per-type rule: a receipt entry for stock a STAFF member received stays visible to staff.
//
// Transfer Corrections added the same day, as the deferred follow-up. The ordinary Transfer query
// below now excludes REVERSAL transfers (`correctionAsReversal: null`) — a reversal is pure
// internal bookkeeping (undoing the original's stock effect), never a real business event a
// person asked for, so it stays invisible here even though it's a real `Transfer` row. The
// original and the replacement both stay fully visible, same "corrected: true flag on the
// original, the replacement reads as an ordinary fresh entry" shape the receipt correction
// already established.
//
// DELIBERATELY A READ-TIME MERGE, NOT A SHARED EVENT-LOG TABLE. No such table exists in this
// codebase and this endpoint doesn't create one. Every source below already carries the three
// things a feed entry needs — a timestamp, an actor, and enough relations to describe itself — so
// a second, denormalised copy of that data would be a duplicate source of truth to keep in sync
// for no gain. Same reasoning this project already applies to the Factory payable figure and the
// party dues tracker: compute it at read time, never cache it into its own table.
//
// The trade-off, stated honestly: because the sort happens in application memory across seven
// separate queries, this can't be paginated efficiently at the database layer. At this business's
// real volume that's a non-issue. If it ever genuinely became one, the fix is per-source
// pagination with a merge cursor — still not a shared table.
//
// ROLE-BASED VISIBILITY (added 2026-08-26, rule 104). OWNER sees every entry, exactly as before.
// STAFF sees only entries whose ACTOR was a STAFF user — shared across all staff, never narrowed
// to just the logged-in one, so two staff members see the same feed as each other. An entry for an
// action an OWNER performed (billing an order, correcting a receipt, a price-touching correction)
// is never sent to a STAFF request at all — filtered in the database queries below, not hidden in
// the UI, same principle as costPrice never being SELECTed for a STAFF request elsewhere.
//
// A LIVE JOIN TO User.role IS CORRECT HERE, and this is the one place that claim needs defending,
// because this project's standing convention is the opposite: priceAtOrder, costPriceSnapshot and
// rule 101's billing amounts all snapshot a value at action time precisely because a live lookup
// would let a later edit rewrite history. The difference is that those fields are all editable
// after the fact, and User.role is not. Verified rather than assumed, by reading every write to an
// existing User row in this codebase (there are exactly eight): userController's deactivate
// (isActive), reactivate (isActive), updateOwnPin (priceEditPinHash/failedPinAttempts/
// pinLockedUntil), resetUserPassword (passwordHash) and updateUser (name/username only — it
// destructures just those two from the body, so a `role` key in a request is silently ignored, not
// applied); requirePin's two lockout-counter writes; and seed.js's backfill (priceEditPinHash/
// isPrimaryOwner). `role` appears in a `data` payload only inside prisma.user.CREATE. There is no
// change-role endpoint, and no route accepts a role for an existing account. So a user's role is
// fixed for life at creation, which makes "their role now" and "their role when they acted"
// necessarily the same value — a snapshot column would be a second copy of an immutable fact, and
// could only ever drift from it by being wrong. Users are also never hard-deleted (isActive
// soft-deactivation only, see User.isActive's own schema comment: "Transaction rows reference
// userId and must stay resolvable forever"), so the join can never fail to resolve an actor.
//
// This is also why no backfill is needed for pre-existing entries: the join answers correctly for
// every historical row already in the database, not just rows created from now on.
//
// costPrice never appears here, at any role: no price field of any kind is selected below.
// priceAtOrder isn't selected either — a history feed has no need for it. The Transaction
// Correction entry DOES read costPriceSnapshot on both the original and replacement Transaction,
// but only to compute a boolean ("did price change") — the actual numbers are discarded before
// the response is built, never forwarded (same "select it, use it internally, never let it reach
// the response" shape createTransaction already uses for the same field). A Transfer never
// carries a price at all, so its correction entry has no equivalent concern.

// Human labels for OrderAdjustment.reason. Taken verbatim from the enum's own schema comments
// (schema.prisma) rather than invented here, so the wording a user reads matches the wording the
// schema itself documents as that value's meaning.
const REASON_LABELS = {
  QUANTITY_REDUCED: 'Quantity reduced by Party',
  ORDER_CANCELLED: 'Order cancelled',
  RETURN_AFTER_DELIVERY: 'Return after delivery',
  MISCALCULATION: 'Miscalculation / data-entry error',
  // Shortened from the schema's "Short-packed (insufficient stock)" for the same reason
  // ORDER_CANCELLED is shortened above: these labels get wrapped in parentheses inside a
  // description, and the full text would nest parens awkwardly ("...5 → 3 sets (Short-packed
  // (insufficient stock))"). The dropped detail is already implied by the numbers falling.
  SHORT_PACKED: 'Short-packed',
  OTHER: 'Other',
};

// Human labels for GoodReturnReason — a SEPARATE table from REASON_LABELS above, because they are
// separate enums answering different questions (why a number on an order changed vs. why physical
// goods came back). Merging them into one lookup would work only by accident, and would break the
// moment either enum gained a value the other didn't have. Taken verbatim from the enum's own
// schema comments, same convention as REASON_LABELS.
const RETURN_REASON_LABELS = {
  NOT_ORDERED: 'Not ordered',
  SIZE_ISSUE: 'Size issue',
  COLOUR_NOT_ORDERED: 'Colour not ordered',
  COLOUR_BLEEDING: 'Colour bleeding',
  ACCESSORIES_ISSUE: 'Accessories issue',
  OTHER: 'Other',
};

// Human labels for TransactionCorrectionReason — a third separate table, same reasoning
// REASON_LABELS/RETURN_REASON_LABELS above already give for keeping these apart: a different
// enum answering a different question (why a Receive Stock receipt was wrong).
const CORRECTION_REASON_LABELS = {
  WRONG_QUANTITY: 'Wrong quantity',
  WRONG_LOCATION: 'Wrong location',
  WRONG_FACTORY: 'Wrong factory',
  WRONG_PRICE: 'Wrong price',
  OTHER: 'Other',
};

// Human labels for TransferCorrectionReason — its own enum, its own table, same reasoning as
// CORRECTION_REASON_LABELS above: a Transfer can get its quantity or either location wrong, but
// has no Factory and no price, so this list is deliberately shaped differently from that one.
const TRANSFER_CORRECTION_REASON_LABELS = {
  WRONG_QUANTITY: 'Wrong quantity',
  WRONG_FROM_LOCATION: 'Wrong from-location',
  WRONG_TO_LOCATION: 'Wrong to-location',
  OTHER: 'Other',
};

// "PACKED" -> "packed", used to build "Order packed" / "Order billed" / "Order shipped" without a
// separate lookup table that would need updating every time OrderStatus gains a value.
function statusWord(status) {
  return String(status).toLowerCase();
}

// "PACKED" -> "Packed", the tag text for a status entry. Deliberately built ON TOP of
// statusWord() and fed the same OrderAdjustment.newValue the description uses, rather than being
// a second { PACKED: 'Packed', ... } lookup sitting alongside it: a separate table could silently
// disagree with the description (or miss a value entirely) the moment OrderStatus gains a stage.
// Deriving both from one input makes disagreement unrepresentable.
function statusLabel(status) {
  const word = statusWord(status);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function articleLabel(lineItem) {
  return `${lineItem.bundle.product.articleNo} ${lineItem.bundle.color.name}`;
}

// Builds the actor-role condition for one source query (rule 104). Every source below links to its
// actor through a differently-NAMED relation — createdBy, changedBy, user, correctedBy — while
// asking the identical question of all of them, so the relation name is the parameter and the
// question is the shared part. Returns an empty object for an OWNER, which spreads into a `where`
// as nothing at all, leaving the owner's queries byte-for-byte what they were before this feature.
function actorScope(relationName, viewerRole) {
  if (viewerRole === 'OWNER') return {};
  return { [relationName]: { role: 'STAFF' } };
}

async function listHistory(req, res) {
  // The viewer's own role, re-derived from the database by requireAuth on every request (never
  // read from the JWT payload) — so a deactivated or changed account can't keep an old role alive
  // through a still-valid token.
  const viewerRole = req.user.role;

  // Seven independent reads, run concurrently — they share no data, so there's no reason to
  // serialise them.
  const [orders, adjustments, transfers, returns, receipts, corrections, transferCorrections] = await Promise.all([
    prisma.order.findMany({
      where: { ...actorScope('createdBy', viewerRole) },
      select: {
        id: true,
        createdAt: true,
        // role rides along with name on every actor select below — it's what the fail-closed
        // backstop filter at the end of this function checks each built entry against.
        createdBy: { select: { name: true, role: true } },
        party: { select: { name: true } },
        // _count rather than pulling every line item just to length them — the feed only ever
        // shows the count for a creation entry.
        _count: { select: { lineItems: true } },
      },
    }),

    prisma.orderAdjustment.findMany({
      where: { ...actorScope('changedBy', viewerRole) },
      select: {
        id: true,
        changedAt: true,
        field: true,
        oldValue: true,
        newValue: true,
        reason: true,
        changedBy: { select: { name: true, role: true } },
        order: { select: { party: { select: { name: true } } } },
        // Null for order-level changes (a status transition); populated for line-level ones,
        // which is what lets the description name the specific article/colour.
        lineItem: {
          select: {
            bundle: {
              select: {
                product: { select: { articleNo: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    }),

    // One row per transfer event, straight from the Transfer table. Deliberately NOT reconstructed
    // from the paired TRANSFER_OUT/TRANSFER_IN Transaction rows: those are the stock-movement side
    // effects of this row (linked back via Transaction.transferId), not the event itself. Reading
    // them instead would mean pairing legs by transferId and risking two entries per transfer, to
    // arrive at data this table already holds directly.
    prisma.transfer.findMany({
      // Excludes reversal transfers created by a Transfer Correction — pure bookkeeping, never a
      // real business event a person asked for (see this file's own header comment).
      where: { correctionAsReversal: null, ...actorScope('user', viewerRole) },
      select: {
        id: true,
        bundleId: true,
        fromLocationId: true,
        toLocationId: true,
        createdAt: true,
        qtySets: true,
        user: { select: { name: true, role: true } },
        bundle: {
          select: {
            product: { select: { articleNo: true } },
            color: { select: { name: true } },
          },
        },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        correctionAsOriginal: { select: { id: true } },
      },
    }),

    // One row per returned line, straight from PartyStockReturn — the same choice made for
    // Transfer above and for the same reason: the paired STOCK_IN Transaction is the stock-movement
    // side effect of this row (linked back via Transaction.partyStockReturnId), not the event
    // itself. priceAtReturn is deliberately NOT selected: it's a selling price, so nothing forbids
    // it, but a history feed has no use for it — same call already made for priceAtOrder.
    prisma.partyStockReturn.findMany({
      where: { ...actorScope('user', viewerRole) },
      select: {
        id: true,
        createdAt: true,
        qtySets: true,
        reason: true,
        user: { select: { name: true, role: true } },
        party: { select: { name: true } },
        bundle: {
          select: {
            product: { select: { articleNo: true } },
            color: { select: { name: true } },
          },
        },
        location: { select: { name: true } },
      },
    }),

    // Receive Stock receipts (STOCK_IN Transactions). Added 2026-08-21 alongside Transaction
    // Corrections — this feed had NO receiving source at all before (verified by reading this
    // function, not assumed from the task's own description of "current sources," which named
    // Transactions as already-merged when it wasn't). A receipt needs to be visible here for two
    // reasons: it's a real warehouse event same as a Transfer or a Good Return, and it's the only
    // place an OWNER can find a specific receipt to correct — the correction action lives on this
    // feed (dashboard/History.jsx), so what it corrects has to live here too. `corrections` rides
    // along (not exposed directly) purely so the entry can flag whether it's already been
    // corrected, without a second round trip.
    prisma.transaction.findMany({
      where: { type: 'STOCK_IN', ...actorScope('user', viewerRole) },
      select: {
        id: true,
        qtySets: true,
        createdAt: true,
        user: { select: { name: true, role: true } },
        stock: {
          select: {
            bundleId: true,
            locationId: true,
            bundle: {
              select: {
                product: { select: { articleNo: true } },
                color: { select: { name: true } },
              },
            },
            location: { select: { name: true } },
          },
        },
        correctionAsOriginal: { select: { id: true } },
      },
    }),

    // Transaction Corrections — one entry per correction event. costPriceSnapshot IS selected on
    // both sides below, but ONLY to compute a boolean ("did price change") — never forwarded into
    // the response. This feed excludes cost price for every role, always (see this file's own
    // header comment); a correction is no exception just because it's owner-triggered, since
    // GET /api/history itself has no role branching at all.
    // In practice this whole source resolves to zero rows for a STAFF viewer, since POST
    // /api/transaction-corrections is OWNER-gated so every row here necessarily has an OWNER
    // actor. The scope is still applied rather than special-cased: it costs nothing, and it means
    // this query states its own visibility rule instead of depending on a gate in a different file
    // staying OWNER-only forever.
    prisma.transactionCorrection.findMany({
      where: { ...actorScope('correctedBy', viewerRole) },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        correctedBy: { select: { name: true, role: true } },
        original: {
          select: {
            qtySets: true,
            costPriceSnapshot: true,
            stock: {
              select: {
                bundleId: true,
                locationId: true,
                bundle: { select: { product: { select: { articleNo: true } }, color: { select: { name: true } } } },
                location: { select: { name: true } },
              },
            },
          },
        },
        replacement: {
          select: {
            qtySets: true,
            costPriceSnapshot: true,
            stock: {
              select: {
                bundleId: true,
                locationId: true,
                bundle: { select: { product: { select: { articleNo: true } }, color: { select: { name: true } } } },
                location: { select: { name: true } },
              },
            },
          },
        },
      },
    }),

    // Transfer Corrections — one entry per correction event. No price concern here at all: a
    // Transfer never carries one.
    // Same as transactionCorrection above: OWNER-gated at the route, so empty for STAFF in
    // practice, but scoped here on its own terms rather than relying on that.
    prisma.transferCorrection.findMany({
      where: { ...actorScope('correctedBy', viewerRole) },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        correctedBy: { select: { name: true, role: true } },
        originalTransfer: {
          select: {
            qtySets: true,
            fromLocationId: true,
            toLocationId: true,
            fromLocation: { select: { name: true } },
            toLocation: { select: { name: true } },
          },
        },
        replacementTransfer: {
          select: {
            qtySets: true,
            fromLocationId: true,
            toLocationId: true,
            fromLocation: { select: { name: true } },
            toLocation: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const entries = [];

  // --- Order creation. No OrderAdjustment row exists for creation itself (adjustments only
  // record CHANGES to an order that already exists), so this is pulled from Order directly.
  for (const o of orders) {
    const lines = o._count.lineItems;
    entries.push({
      id: `ORDER_PLACED:${o.id}`,
      type: 'ORDER_PLACED',
      label: 'Placed',
      timestamp: o.createdAt,
      actorName: o.createdBy.name,
      actorRole: o.createdBy.role,
      partyName: o.party.name,
      description: `${o.party.name} order placed — ${lines} line${lines === 1 ? '' : 's'}`,
    });
  }

  // --- Order adjustments: status transitions, quantity changes, short-packs.
  for (const a of adjustments) {
    const partyName = a.order.party.name;
    const reasonLabel = a.reason ? REASON_LABELS[a.reason] ?? a.reason : null;

    if (a.field === 'status') {
      // Routine forward progress (reason is null by design for these — see schema.prisma).
      entries.push({
        id: `ORDER_STATUS:${a.id}`,
        type: 'ORDER_STATUS',
        // "Packed" / "Billed" / "Shipped" — the actual moment, not a generic "Status". Same
        // a.newValue the description below is built from, so the two can never disagree.
        label: statusLabel(a.newValue),
        timestamp: a.changedAt,
        actorName: a.changedBy.name,
        actorRole: a.changedBy.role,
        partyName,
        description: `${partyName}: order ${statusWord(a.newValue)}`,
      });
    } else if (a.field === 'isCancelled') {
      // Its own branch, because the generic old → new wording below would render this as
      // "SAI — 6023 Olive Green: false → true sets (Order cancelled)" — technically accurate and
      // completely unreadable. A cancellation is a state, not a quantity change, so it gets a
      // plain sentence and its own "Cancelled" tag rather than the generic "Change".
      entries.push({
        id: `ORDER_ADJUSTMENT:${a.id}`,
        type: 'ORDER_ADJUSTMENT',
        label: 'Cancelled',
        timestamp: a.changedAt,
        actorName: a.changedBy.name,
        actorRole: a.changedBy.role,
        partyName,
        description: a.lineItem
          ? `${partyName} — ${articleLabel(a.lineItem)}: line cancelled`
          : `${partyName}: whole order cancelled`,
      });
    } else {
      // A line-level change. lineItem is populated whenever lineItemId was set, which is what
      // lets this name the actual article/colour rather than an opaque line id.
      const what = a.lineItem ? `${articleLabel(a.lineItem)}: ` : '';
      const suffix = reasonLabel ? ` (${reasonLabel})` : '';
      entries.push({
        id: `ORDER_ADJUSTMENT:${a.id}`,
        type: 'ORDER_ADJUSTMENT',
        label: 'Change',
        timestamp: a.changedAt,
        actorName: a.changedBy.name,
        actorRole: a.changedBy.role,
        partyName,
        description: `${partyName} — ${what}${a.oldValue} → ${a.newValue} sets${suffix}`,
      });
    }
  }

  // --- Transfers: one entry per Transfer row (see the query comment above).
  for (const t of transfers) {
    const article = `${t.bundle.product.articleNo} ${t.bundle.color.name}`;
    entries.push({
      id: `TRANSFER:${t.id}`,
      type: 'TRANSFER',
      label: 'Transfer',
      timestamp: t.createdAt,
      actorName: t.user.name,
      actorRole: t.user.role,
      partyName: null,
      description: `${t.qtySets} set${t.qtySets === 1 ? '' : 's'} of ${article} transferred ${t.fromLocation.name} → ${t.toLocation.name}`,
      // Not purely display fields — read by dashboard/History.jsx's OWNER-only Correct action to
      // pre-fill the correction form and to know whether one already exists. Same reasoning as
      // RECEIPT's own extra fields above: any role can read these (IDs/qty/names, never price).
      transferId: t.id,
      corrected: t.correctionAsOriginal != null,
      qtySets: t.qtySets,
      bundleId: t.bundleId,
      articleNo: t.bundle.product.articleNo,
      colorName: t.bundle.color.name,
      fromLocationId: t.fromLocationId,
      toLocationId: t.toLocationId,
      fromLocationName: t.fromLocation.name,
      toLocationName: t.toLocation.name,
    });
  }

  // --- Transfer Corrections: one entry per correction event, describing what changed.
  for (const c of transferCorrections) {
    const changes = [];
    if (c.originalTransfer.qtySets !== c.replacementTransfer.qtySets) {
      changes.push(`${c.originalTransfer.qtySets} → ${c.replacementTransfer.qtySets} sets`);
    }
    if (c.originalTransfer.fromLocationId !== c.replacementTransfer.fromLocationId) {
      changes.push(`from ${c.originalTransfer.fromLocation.name} → ${c.replacementTransfer.fromLocation.name}`);
    }
    if (c.originalTransfer.toLocationId !== c.replacementTransfer.toLocationId) {
      changes.push(`to ${c.originalTransfer.toLocation.name} → ${c.replacementTransfer.toLocation.name}`);
    }

    entries.push({
      id: `TRANSFER_CORRECTION:${c.id}`,
      type: 'TRANSFER_CORRECTION',
      label: 'Corrected',
      timestamp: c.createdAt,
      actorName: c.correctedBy.name,
      actorRole: c.correctedBy.role,
      partyName: null,
      description: `Transfer corrected — ${changes.join(', ')} (${TRANSFER_CORRECTION_REASON_LABELS[c.reason] ?? c.reason})`,
    });
  }

  // --- Good Returns: one entry per returned line (see the query comment above).
  for (const r of returns) {
    const article = `${r.bundle.product.articleNo} ${r.bundle.color.name}`;
    const reasonLabel = RETURN_REASON_LABELS[r.reason] ?? r.reason;
    entries.push({
      id: `GOOD_RETURN:${r.id}`,
      type: 'GOOD_RETURN',
      label: 'Return',
      timestamp: r.createdAt,
      actorName: r.user.name,
      actorRole: r.user.role,
      partyName: r.party.name,
      // The reason is the whole point of a return entry — what came back matters less than why,
      // so it's in the sentence itself rather than a parenthetical afterthought.
      description: `${r.party.name} returned ${r.qtySets} set${r.qtySets === 1 ? '' : 's'} of ${article} into ${r.location.name} — ${reasonLabel}`,
    });
  }

  // --- Receive Stock receipts: one entry per STOCK_IN transaction.
  for (const t of receipts) {
    const article = `${t.stock.bundle.product.articleNo} ${t.stock.bundle.color.name}`;
    entries.push({
      id: `RECEIPT:${t.id}`,
      type: 'RECEIPT',
      label: 'Received',
      timestamp: t.createdAt,
      actorName: t.user.name,
      actorRole: t.user.role,
      partyName: null,
      description: `${t.qtySets} set${t.qtySets === 1 ? '' : 's'} of ${article} received at ${t.stock.location.name}`,
      // Not purely display fields — read by dashboard/History.jsx's OWNER-only Correct action to
      // pre-fill the correction form with this receipt's current values, and to know whether one
      // already exists. Any role can read these (IDs/qty/names, never price); the correction
      // ACTION itself is what's actually gated, both server-side (POST
      // /api/transaction-corrections requires OWNER) and client-side (the button only renders on
      // the dashboard's own OWNER-gated route).
      transactionId: t.id,
      corrected: t.correctionAsOriginal != null,
      qtySets: t.qtySets,
      bundleId: t.stock.bundleId,
      locationId: t.stock.locationId,
      articleNo: t.stock.bundle.product.articleNo,
      colorName: t.stock.bundle.color.name,
      locationName: t.stock.location.name,
    });
  }

  // --- Transaction Corrections: one entry per correction event, describing what changed.
  for (const c of corrections) {
    const origArticle = `${c.original.stock.bundle.product.articleNo} ${c.original.stock.bundle.color.name}`;
    const newArticle = `${c.replacement.stock.bundle.product.articleNo} ${c.replacement.stock.bundle.color.name}`;
    const priceChanged =
      (c.original.costPriceSnapshot != null ? c.original.costPriceSnapshot.toString() : null) !==
      (c.replacement.costPriceSnapshot != null ? c.replacement.costPriceSnapshot.toString() : null);

    const changes = [];
    if (c.original.qtySets !== c.replacement.qtySets) {
      changes.push(`${c.original.qtySets} → ${c.replacement.qtySets} sets`);
    }
    if (c.original.stock.bundleId !== c.replacement.stock.bundleId) {
      changes.push(`${origArticle} → ${newArticle}`);
    }
    if (c.original.stock.locationId !== c.replacement.stock.locationId) {
      changes.push(`${c.original.stock.location.name} → ${c.replacement.stock.location.name}`);
    }
    // Deliberately no numbers here — costPrice never appears in this feed, at any role (see this
    // file's own header comment). The fact that price changed is still worth stating.
    if (priceChanged) {
      changes.push('cost price updated');
    }

    entries.push({
      id: `RECEIPT_CORRECTION:${c.id}`,
      type: 'RECEIPT_CORRECTION',
      label: 'Corrected',
      timestamp: c.createdAt,
      actorName: c.correctedBy.name,
      actorRole: c.correctedBy.role,
      partyName: null,
      description: `Receipt corrected — ${changes.join(', ')} (${CORRECTION_REASON_LABELS[c.reason] ?? c.reason})`,
    });
  }

  // Rule 104 backstop. The seven `where` clauses above are the real enforcement — an OWNER's rows
  // are never fetched for a STAFF request in the first place — so for correct code this filter
  // removes nothing. It exists because the enforcement is spread across seven separate queries,
  // and the failure mode of adding an eighth source later is forgetting one of them. This is the
  // single place every entry must pass through regardless of which source built it.
  //
  // Deliberately an ALLOWLIST (`=== 'STAFF'`) rather than a denylist (`!== 'OWNER'`), because the
  // two differ exactly in the case that matters: a new source whose actor select forgot `role`
  // yields `actorRole: undefined`, which a denylist would treat as safe and SHOW to staff — the
  // precise leak this is here to prevent. An allowlist hides anything it cannot positively confirm
  // is staff-performed, so a mistake becomes a missing entry rather than a disclosure.
  const visibleEntries =
    viewerRole === 'OWNER' ? entries : entries.filter((e) => e.actorRole === 'STAFF');

  // Newest first, with id as a deterministic tiebreak: several events can legitimately share a
  // timestamp (billing writes its stock transactions and its status adjustment inside one database
  // transaction), and without a tiebreak their relative order could differ between two identical
  // requests — which would make the list appear to shuffle on refresh.
  visibleEntries.sort((a, b) => {
    const diff = new Date(b.timestamp) - new Date(a.timestamp);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  res.json(visibleEntries);
}

module.exports = { listHistory };
