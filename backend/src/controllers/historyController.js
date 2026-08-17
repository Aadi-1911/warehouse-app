const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/history — any authenticated role (🔒). A unified, read-only feed of what's happened
// across Orders and Transfers, newest first.
//
// DELIBERATELY A READ-TIME MERGE, NOT A SHARED EVENT-LOG TABLE. No such table exists in this
// codebase and this endpoint doesn't create one. Every source below already carries the three
// things a feed entry needs — a timestamp, an actor, and enough relations to describe itself — so
// a second, denormalised copy of that data would be a duplicate source of truth to keep in sync
// for no gain. Same reasoning this project already applies to the Factory payable figure and the
// party dues tracker: compute it at read time, never cache it into its own table.
//
// The trade-off, stated honestly: because the sort happens in application memory across three
// separate queries, this can't be paginated efficiently at the database layer. At this business's
// real volume that's a non-issue (the whole feed is currently ~19 entries, and even a few hundred
// events a month stays trivial for years). If it ever genuinely became one, the fix is per-source
// pagination with a merge cursor — still not a shared table.
//
// costPrice never appears here, at any role: no price field of any kind is selected below.
// priceAtOrder isn't selected either — a history feed has no need for it.

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

async function listHistory(req, res) {
  // Three independent reads, run concurrently — they share no data, so there's no reason to
  // serialise them.
  const [orders, adjustments, transfers] = await Promise.all([
    prisma.order.findMany({
      select: {
        id: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        party: { select: { name: true } },
        // _count rather than pulling every line item just to length them — the feed only ever
        // shows the count for a creation entry.
        _count: { select: { lineItems: true } },
      },
    }),

    prisma.orderAdjustment.findMany({
      select: {
        id: true,
        changedAt: true,
        field: true,
        oldValue: true,
        newValue: true,
        reason: true,
        changedBy: { select: { name: true } },
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
      select: {
        id: true,
        createdAt: true,
        qtySets: true,
        user: { select: { name: true } },
        bundle: {
          select: {
            product: { select: { articleNo: true } },
            color: { select: { name: true } },
          },
        },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
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
        partyName,
        description: `${partyName}: order ${statusWord(a.newValue)}`,
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
      partyName: null,
      description: `${t.qtySets} set${t.qtySets === 1 ? '' : 's'} of ${article} transferred ${t.fromLocation.name} → ${t.toLocation.name}`,
    });
  }

  // Newest first, with id as a deterministic tiebreak: several events can legitimately share a
  // timestamp (billing writes its stock transactions and its status adjustment inside one database
  // transaction), and without a tiebreak their relative order could differ between two identical
  // requests — which would make the list appear to shuffle on refresh.
  entries.sort((a, b) => {
    const diff = new Date(b.timestamp) - new Date(a.timestamp);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  res.json(entries);
}

module.exports = { listHistory };
