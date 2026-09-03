const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { piecesPerSetFor } = require('../utils/piecesPerSet');
const { orderValueOf } = require('../utils/orderValue');
const { normalizeBillNo } = require('../utils/billNo');

const prisma = new PrismaClient();

// Never includes costPrice anywhere — Orders are a selling-price-facing feature (rule 10),
// cost price has no reason to appear here at all, same "select, don't strip" guarantee used
// for costPrice on Products/Transactions.
const LINE_ITEM_SELECT = {
  id: true,
  bundleId: true,
  qtySetsRequested: true,
  qtySetsPacked: true,
  isCancelled: true,
  priceAtOrder: true,
  productNameSnapshot: true,
  bundle: {
    select: {
      // isKids + sizes are the piecesPerSetFor shape (utils/piecesPerSet.js) — needed so a
      // client (Bill Order's per-article total) can convert sets to pieces itself, same shape
      // productController's productSelect already exposes elsewhere.
      product: { select: { id: true, articleNo: true, name: true, isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } },
      color: { select: { id: true, name: true } },
    },
  },
};

// A FUNCTION of the requester's role, not a plain constant, purely because of `billNo` (added
// 2026-08-30). Every other field here is identical for both roles; billNo is the one field that
// must never reach a STAFF response, and this select feeds any-role endpoints — GET
// /api/orders/:id, packOrder and shipOrder are all reachable by STAFF (rule 63), and STAFF's Pack
// Order and Dispatch Order screens genuinely use them.
//
// billNo is therefore left out of the SELECT itself for a STAFF request, so it is never fetched
// from Postgres at all — deliberately the same never-fetch-it approach productSelect(role)
// already takes for costPrice, rather than selecting it and deleting the key before responding.
// A stripped field is one forgotten `res.json(order)` away from leaking; a field that was never
// read out of the database cannot leak by any path.
function orderDetailSelect(role) {
  return {
    id: true,
    partyId: true,
    party: { select: { name: true } },
    partyNameSnapshot: true,
    status: true,
    createdById: true,
    createdBy: { select: { name: true } },
    createdAt: true,
    packedAt: true,
    billedAt: true,
    shippedAt: true,
    isCancelled: true,
    // Billing snapshot (rule 101) — null/false for any order not yet BILLED. Selected here so
    // GET /api/orders/:id and billOrder()'s own response both surface the real stored figures,
    // not just the client's own live preview from before confirming.
    discountApplicable: true,
    discountPercent: true,
    gstApplicable: true,
    gstPercent: true,
    preTaxAmount: true,
    finalAmount: true,
    actualPayable: true,
    ...(role === 'OWNER' ? { billNo: true } : {}),
    lineItems: { select: LINE_ITEM_SELECT },
  };
}

function lineItemToResponse(li) {
  return {
    id: li.id,
    bundleId: li.bundleId,
    productId: li.bundle.product.id,
    productArticleNo: li.bundle.product.articleNo,
    // The snapshot taken when this line was created, falling back to the live Product.name only
    // for lines that predate productNameSnapshot existing (2026-08-28) and therefore have no
    // recorded name to recover. Post-fix lines are immune to a later rename; pre-fix lines still
    // follow the current name, which is the only value that was ever available for them — a
    // disclosed limitation, see the schema comment on OrderLineItem.productNameSnapshot.
    productName: li.productNameSnapshot ?? li.bundle.product.name,
    // Flattened alongside the other product* fields above, same reasoning — lets a client
    // reconstruct { isKids, sizes } and call its own piecesPerSetFor without a second request.
    productIsKids: li.bundle.product.isKids,
    productSizes: li.bundle.product.sizes,
    colorId: li.bundle.color.id,
    colorName: li.bundle.color.name,
    qtySetsRequested: li.qtySetsRequested,
    qtySetsPacked: li.qtySetsPacked,
    isCancelled: li.isCancelled,
    priceAtOrder: li.priceAtOrder,
  };
}

// `role` must be the same one passed to orderDetailSelect above — for a STAFF request the row
// simply has no billNo property to read, so the two conditionals can't disagree in a way that
// either invents the field or leaks it.
function orderDetailToResponse(o, role) {
  return {
    id: o.id,
    partyId: o.partyId,
    // Snapshot first, live name only as the pre-2026-09-02 fallback — see
    // Order.partyNameSnapshot's schema comment for the full reasoning.
    partyName: o.partyNameSnapshot ?? o.party.name,
    status: o.status,
    createdById: o.createdById,
    createdByName: o.createdBy.name,
    createdAt: o.createdAt,
    packedAt: o.packedAt,
    billedAt: o.billedAt,
    shippedAt: o.shippedAt,
    isCancelled: o.isCancelled,
    discountApplicable: o.discountApplicable,
    discountPercent: o.discountPercent,
    gstApplicable: o.gstApplicable,
    gstPercent: o.gstPercent,
    preTaxAmount: o.preTaxAmount,
    finalAmount: o.finalAmount,
    actualPayable: o.actualPayable,
    ...(role === 'OWNER' ? { billNo: o.billNo ?? null } : {}),
    lineItems: o.lineItems.map(lineItemToResponse),
  };
}

// POST /api/orders — any authenticated role (🔒). Staff creating orders during a sample visit
// is the PRIMARY real-world use case here (05_BUSINESS_RULES.md rule 25), not an owner action —
// this project has already shipped one OWNER-only role-gate mistake on a staff-primary flow
// (POST /api/bundles, see LEARNING_LOG.md), so this is deliberately any-role, not a default
// carried over by accident.
//
// Body: { partyId, lineItems: [{ bundleId, qtySetsRequested }] }. Every line item is fully
// validated (Party active, every Bundle real, every Product actually priced) BEFORE the DB is
// touched at all — this is what makes "one bad line ⇒ nothing created" true by construction,
// not by relying on a transaction rollback after a partial write was attempted.
async function createOrder(req, res) {
  const { partyId, lineItems } = req.body;

  if (!partyId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'partyId is required');
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lineItems must be a non-empty array');
  }
  for (const li of lineItems) {
    if (!li || !li.bundleId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line item requires a bundleId');
    }
    if (!Number.isInteger(li.qtySetsRequested) || li.qtySetsRequested <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line item requires a positive integer qtySetsRequested');
    }
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${partyId}`);
  }
  if (!party.isActive) {
    return sendError(res, 409, 'PARTY_ARCHIVED', `Party "${party.name}" is archived and cannot receive new orders`);
  }

  // One batch fetch for every bundle referenced, rather than one query per line item — same
  // "resolve everything, then validate" shape as the rest of this check, and avoids N+1 queries
  // for a multi-line order.
  const bundleIds = [...new Set(lineItems.map((li) => li.bundleId))];
  const bundles = await prisma.bundle.findMany({
    where: { id: { in: bundleIds } },
    select: { id: true, product: { select: { sellingPrice: true, name: true } } },
  });
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  // priceAtOrder is computed HERE, server-side, from Product.sellingPrice at this exact
  // moment — never trusted from the request body, same principle as Transaction.
  // costPriceSnapshot. Resolved fully before any DB write, so a bad bundleId or an unpriced
  // product anywhere in the array rejects the whole request with zero rows created.
  // productNameSnapshot (2026-08-28) is captured from the same read, at the same instant, for
  // exactly the same reason — a later rename must not rewrite what this order said it was for.
  const resolvedLineItems = [];
  for (const li of lineItems) {
    const bundle = bundleById.get(li.bundleId);
    if (!bundle) {
      return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${li.bundleId}`);
    }
    if (bundle.product.sellingPrice == null) {
      return sendError(
        res,
        400,
        'UNPRICED_PRODUCT',
        `The article for bundle ${li.bundleId} has no selling price set yet and cannot be ordered`
      );
    }
    resolvedLineItems.push({
      bundleId: li.bundleId,
      qtySetsRequested: li.qtySetsRequested,
      priceAtOrder: bundle.product.sellingPrice,
      productNameSnapshot: bundle.product.name,
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        partyId,
        createdById: req.user.id,
        // Captured from the same `party` read already used for the isActive check above, at
        // this exact instant — never from the request body, same principle as
        // resolvedLineItems' own priceAtOrder/productNameSnapshot immediately above.
        partyNameSnapshot: party.name,
        lineItems: { create: resolvedLineItems },
      },
    });
    // Re-read inside the transaction, with the full display-ready select, so the response
    // reflects the true post-write state rather than being reassembled in JS from inputs.
    return tx.order.findUnique({ where: { id: order.id }, select: orderDetailSelect(req.user.role) });
  });

  res.status(201).json(orderDetailToResponse(created, req.user.role));
}

// GET /api/orders — any authenticated role (🔒). Lightweight list: party name and a
// line-item summary (count + total value), not full nested line detail — same "line count,
// value" summary shape 07_UI_DESIGN_BRIEF.md's Owner Dashboard Orders widget already
// documents, not a new one invented for this endpoint.
async function listOrders(req, res) {
  const { partyId, status, from, to } = req.query;

  const where = {};
  if (partyId) where.partyId = partyId;
  // A status-scoped list is a WORKLIST — "what's waiting to be packed/billed/shipped" — so a
  // cancelled order has no business appearing on one. Scoped to the status filter deliberately:
  // an unfiltered GET /api/orders is a general query (History, reporting) and still returns
  // everything, and GET /api/orders/:id always resolves a cancelled order so direct links work.
  if (status) {
    where.status = status;
    where.isCancelled = false;
  }
  if (from || to) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((from && isNaN(fromDate)) || (to && isNaN(toDate))) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'from/to must be valid dates');
    }
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      partyId: true,
      party: { select: { name: true } },
      partyNameSnapshot: true,
      status: true,
      // Selected (though excluded from the status-filtered worklist queries above) so an
      // unfiltered caller — e.g. the Owner Dashboard's Orders page, which intentionally shows
      // every order including cancelled ones (rule per the comment above) — can actually tell
      // the two apart instead of a cancelled order rendering identically to an active one.
      isCancelled: true,
      createdAt: true,
      // The stage timestamps ride along so a status-scoped list can show the date that actually
      // matters for ITS stage — Bill Orders (status=PACKED) shows when it was packed, Ship Order
      // (status=BILLED) shows when it was billed. createdAt alone can't serve both.
      packedAt: true,
      billedAt: true,
      shippedAt: true,
      // The rule 101 billing snapshot. Selected purely so totalValue below can prefer the real
      // stored amount owed over the pre-tax line-item sum (rule 103) — without this select it
      // would be undefined on every row and orderValueOf would silently fall back forever,
      // which is exactly the quiet-wrong-money failure this fix exists to remove.
      actualPayable: true,
      // OWNER-only, same never-fetch-for-STAFF reasoning as orderDetailSelect above — this is an
      // any-role endpoint and STAFF's Pack/Dispatch worklists read it.
      ...(req.user.role === 'OWNER' ? { billNo: true } : {}),
      // The real cancellation moment — investigated 2026-08-20 for the Owner Dashboard Orders
      // page's month bucketing. A cancelled order can have been cancelled while PLACED (no
      // packedAt/billedAt/shippedAt at all), so those stage timestamps can't reliably date it.
      // cancelOrder/cancelOrderLine both already write an order-level OrderAdjustment row
      // (field: 'isCancelled', lineItemId: null) with a real changedAt the moment cancellation
      // happens — the same append-only audit trail every other status transition uses (rule 9),
      // not a new mechanism invented for this. take: 1 + orderBy desc gets the one that matters
      // (an order can only be order-level-cancelled once — cancelOrder 409s on an already-
      // cancelled order — but this is defensive rather than assuming that invariant here too).
      adjustments: {
        where: { field: 'isCancelled', lineItemId: null },
        orderBy: { changedAt: 'desc' },
        take: 1,
        select: { changedAt: true },
      },
      lineItems: {
        // A cancelled line is never billed and has no business inflating either figure below —
        // same filter revenue.js and the dashboard's billedNotShipped/packedNotBilled KPIs already
        // apply, and the same "tally live lines only" convention every order detail screen
        // (Pack/Bill) already uses for its own counts. Filtering here means lineItemCount and
        // totalValue both come from this one already-correct array, rather than each needing its
        // own exclusion logic.
        where: { isCancelled: false },
        select: {
          qtySetsRequested: true,
          priceAtOrder: true,
          // Needed for piecesPerSetFor — costPrice/sizes.costPrice never touched, this is
          // purely the piece-count shape (isKids + sizeLabel), same select revenue.js uses.
          bundle: { select: { product: { select: { isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } } },
        },
      },
    },
  });

  const response = orders.map((o) => ({
    id: o.id,
    partyId: o.partyId,
    // Snapshot first, live name only as the pre-2026-09-02 fallback — see
    // Order.partyNameSnapshot's schema comment for the full reasoning.
    partyName: o.partyNameSnapshot ?? o.party.name,
    status: o.status,
    isCancelled: o.isCancelled,
    createdAt: o.createdAt,
    packedAt: o.packedAt,
    billedAt: o.billedAt,
    shippedAt: o.shippedAt,
    // Only meaningful when isCancelled — the real cancellation timestamp (see the adjustments
    // select above), falling back to the latest stage date that actually exists, then createdAt,
    // ONLY for the unexpected case where an order is order-level-cancelled with no matching
    // OrderAdjustment row (shouldn't happen through cancelOrder's own code path, but this is the
    // one place that reads the fallback chain, not left implicit).
    cancelledAt: o.isCancelled ? (o.adjustments[0]?.changedAt ?? o.billedAt ?? o.packedAt ?? o.createdAt) : null,
    // Present only for OWNER — mirrors the conditional select above, so a STAFF row has no
    // billNo to read in the first place.
    ...(req.user.role === 'OWNER' ? { billNo: o.billNo ?? null } : {}),
    // Cancelled lines are excluded (see the query's where above) — a fully-cancelled order
    // reports 0 lines / ₹0, not an error, since an empty array reduces to 0 cleanly.
    lineItemCount: o.lineItems.length,
    // The real amount owed when this order has one, else the live line-item sum (rule 103).
    //
    // The fallback below is unchanged and still correct for every order without a snapshot:
    // qtySetsRequested × piecesPerSet × priceAtOrder — priceAtOrder is stored PER PIECE
    // (rule 69's 2026-08-19 clarification), so a bare qtySets × price under-counts by the
    // pieces-per-set factor. Same three-factor shape as revenue.js and the factory payable.
    //
    // Fixing it HERE rather than in each screen is deliberate: every list-view rupee figure in
    // the app reads this one field — the Owner Dashboard's Orders page, Party Payables' per-order
    // list, and the mobile Pack/Bill/Ship Order lists — so one server-side fix corrects all of
    // them at once and leaves no screen able to drift back onto the pre-tax number.
    totalValue: orderValueOf(
      o,
      o.lineItems.reduce(
        (sum, li) => sum + li.qtySetsRequested * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder),
        0,
      ),
    ),
  }));

  res.json(response);
}

// GET /api/orders/:id — any authenticated role (🔒). Full detail, all line items, each with
// the article/color info actually needed to display it — same shape POST returns.
async function getOrder(req, res) {
  const { id } = req.params;

  const order = await prisma.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }

  res.json(orderDetailToResponse(order, req.user.role));
}

// PATCH /api/orders/:id/pack — any authenticated role (🔒). Staff is the primary user for this
// transition (rule 63) — the same staff-primary reasoning already documented on createOrder above,
// so this is deliberately any-role, not a default carried over by accident.
//
// Body: { lineItems: [{ lineItemId, qtySetsPacked }] } — one entry per line on this order.
//
// DELIBERATELY SIDE-EFFECT-FREE ON STOCK (changed 2026-08-17). Packing used to perform the FIFO
// stock deduction; it no longer touches Stock or Transaction at all. Packing is a counting step —
// a physical recount staff may legitimately need to redo — and a step that can be repeated is the
// wrong place to hang an irreversible deduction: re-packing an already-packed order would have
// deducted the same stock twice. Deduction now lives on the Bill transition instead, which is
// already rule 23's hard lock (nothing is editable past Billed), so it can only ever run once by
// construction rather than by a guard bolted on afterwards. See billOrder below and
// LEARNING_LOG.md for the full reasoning.
async function packOrder(req, res) {
  const { id } = req.params;
  const { lineItems: submittedLines } = req.body;

  if (!Array.isArray(submittedLines) || submittedLines.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lineItems must be a non-empty array');
  }
  for (const sl of submittedLines) {
    if (!sl || !sl.lineItemId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line item requires a lineItemId');
    }
    if (!Number.isInteger(sl.qtySetsPacked) || sl.qtySetsPacked < 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line item requires a non-negative integer qtySetsPacked');
    }
  }

  const order = await prisma.order.findUnique({
    where: { id },
    // bundleId is deliberately NOT selected — packing no longer touches stock, so it has no use
    // for it. Bill is where bundleId matters now (see billOrder below).
    select: { id: true, status: true, isCancelled: true, lineItems: { select: { id: true, qtySetsRequested: true, isCancelled: true } } },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (order.status !== 'PLACED') {
    return sendError(res, 409, 'ORDER_NOT_PLACED', `Order must be PLACED to pack — current status is ${order.status}`);
  }
  // Without this, a cancelled order could still be packed via a direct call or a stale link —
  // it only disappears from the worklist, which is a display concern, not enforcement.
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order has been cancelled and can no longer be packed');
  }

  // Every submitted lineItemId must belong to this order, and every line ON this order must be
  // covered by exactly one submitted entry — a partial submission would leave some lines with
  // stale qtySetsPacked while the order still moves to PACKED, silently pretending they were
  // handled. REJECT (400) rather than silently defaulting missing lines to 0, same "fail loudly"
  // reasoning the task gives for the packed-quantity range check below.
  // Coverage means every LIVE line, not every line ever created: a cancelled line has nothing to
  // pack, and the UI renders it struck-through and non-editable so it isn't submitted. Its
  // existing qtySetsPacked is left exactly as it was.
  const liveLines = order.lineItems.filter((li) => !li.isCancelled);
  const lineById = new Map(liveLines.map((li) => [li.id, li]));
  const submittedIds = new Set();
  for (const sl of submittedLines) {
    if (!lineById.has(sl.lineItemId)) {
      const exists = order.lineItems.some((li) => li.id === sl.lineItemId);
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        exists
          ? `lineItemId ${sl.lineItemId} has been cancelled and cannot be packed`
          : `lineItemId ${sl.lineItemId} does not belong to order ${id}`
      );
    }
    if (submittedIds.has(sl.lineItemId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `lineItemId ${sl.lineItemId} submitted more than once`);
    }
    submittedIds.add(sl.lineItemId);
  }
  if (submittedIds.size !== liveLines.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lineItems must include exactly one entry for every non-cancelled line on this order');
  }
  for (const sl of submittedLines) {
    const line = lineById.get(sl.lineItemId);
    if (sl.qtySetsPacked > line.qtySetsRequested) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `qtySetsPacked (${sl.qtySetsPacked}) for line ${sl.lineItemId} exceeds qtySetsRequested (${line.qtySetsRequested}) — the UI clamps this client-side, so a value out of range here means something upstream is wrong`
      );
    }
  }

  // No stock reads, no availability pre-check, no INSUFFICIENT_STOCK path: packing records what
  // was counted, it doesn't commit it. A line CAN legitimately be packed for more than is
  // currently on the shelf — that discrepancy surfaces at Bill, which is the transition that
  // actually moves inventory.
  const updated = await prisma.$transaction(async (tx) => {
    for (const sl of submittedLines) {
      const line = lineById.get(sl.lineItemId);

      await tx.orderLineItem.update({
        where: { id: line.id },
        data: { qtySetsPacked: sl.qtySetsPacked },
      });

      // Visible history entry explaining the gap — qtySetsRequested itself never moves
      // (confirmed design decision, not reinterpreted here), so without this row there'd be no
      // record of why a line's packed quantity fell short of what was asked.
      if (sl.qtySetsPacked < line.qtySetsRequested) {
        await tx.orderAdjustment.create({
          data: {
            orderId: id,
            lineItemId: line.id,
            changedById: req.user.id,
            field: 'qtySetsPacked',
            oldValue: String(line.qtySetsRequested),
            newValue: String(sl.qtySetsPacked),
            reason: 'SHORT_PACKED',
          },
        });
      }
    }

    await tx.order.update({
      where: { id },
      data: { status: 'PACKED', packedAt: new Date() },
    });
    // Routine forward progress, not a correction — reason stays null, per the earlier schema
    // decision (03_DATABASE_SCHEMA.md §2's "Hard rules to enforce").
    await tx.orderAdjustment.create({
      data: {
        orderId: id,
        changedById: req.user.id,
        field: 'status',
        oldValue: 'PLACED',
        newValue: 'PACKED',
        reason: null,
      },
    });

    return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  });

  res.json(orderDetailToResponse(updated, req.user.role));
}

// PATCH /api/orders/:id/bill — OWNER ONLY (👑), enforced by requireRole('OWNER') in routes/
// orders.js, NOT by this comment. Deliberately owner-gated where pack and ship are any-role:
// rule 63 states plainly that the "... → Billed" transition is owner-only and must never be
// offered to STAFF, and this is now also the point where real inventory moves.
//
// THIS IS THE STOCK-DEDUCTION POINT (moved here from pack, 2026-08-17). Billing is the
// commitment: it's already rule 23's hard lock (nothing about an order is editable once Billed),
// so a deduction hung here can only ever run once, by construction. Packing, by contrast, is a
// recountable step — deducting there meant a re-pack could deduct the same stock twice. See
// LEARNING_LOG.md.
//
// Deduction picks Location rows FIFO (rule 64) in alphabetical order by Location.name. There's no
// existing "canonical" ordering for Locations anywhere in this codebase to defer to — listLocations
// has no orderBy at all, and Transfer's fromLocationId is a human's explicit pick, never an
// auto-selected one. The one place this app already had to answer "what order do multiple
// Locations go in" is Live Stock's own display grouping (frontend/src/pages/LiveStock.jsx), which
// sorts by locationName.localeCompare(...) — i.e. alphabetical. This is the same convention that
// logic used when it lived in pack, carried over unchanged rather than re-decided.
//
// Body (added 2026-08-25, rule 101): { discountApplicable?, discountPercent?, gstApplicable?,
// gstPercent? } — all optional, defaulting to no discount/no GST. Still no formal Bill document/
// invoice entity (a printable doc is still separate later work) — this remains a pure
// status-transition-plus-deduction endpoint structurally, just one that also snapshots the
// billed amount now that discount/GST are real, owner-entered facts at billing time.
async function billOrder(req, res) {
  const { id } = req.params;

  const {
    discountApplicable = false,
    discountPercent = null,
    gstApplicable = false,
    gstPercent = null,
  } = req.body || {};

  if (typeof discountApplicable !== 'boolean' || typeof gstApplicable !== 'boolean') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'discountApplicable and gstApplicable must be booleans');
  }
  if (discountApplicable && (typeof discountPercent !== 'number' || discountPercent < 0 || discountPercent > 100)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'discountPercent must be a number between 0 and 100 when discountApplicable is true');
  }
  if (gstApplicable && (typeof gstPercent !== 'number' || gstPercent < 0 || gstPercent > 5)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'gstPercent must be a number between 0 and 5 when gstApplicable is true');
  }
  // Optional reference tag, captured at billing time (2026-08-30). Validated alongside the money
  // fields above but deliberately NOT part of any of the rule 101 arithmetic below — it is never
  // read by preTaxAmount/finalAmount/actualPayable, and billing succeeds identically whether it
  // is provided or left blank.
  const billNo = normalizeBillNo(req.body?.billNo);
  if (!billNo.ok) {
    return sendError(res, 400, 'VALIDATION_ERROR', billNo.message);
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      // Was missing here (found 2026-08-20): the guard below read order.isCancelled, but nothing
      // ever selected it at the Order level — only lineItems.isCancelled was fetched, so the
      // field was `undefined`, and `if (order.isCancelled)` never fired for ANY order. Confirmed
      // against the real cancelled order (cmsxewg0...) before this fix: the call bypassed this
      // guard entirely and reached the stock-check stage (409 INSUFFICIENT_STOCK, not 409
      // ORDER_CANCELLED) — it only avoided deducting real stock because that specific order
      // happens to have a bundle with zero stock, not because this guard did its job.
      isCancelled: true,
      lineItems: {
        select: {
          id: true,
          bundleId: true,
          qtySetsPacked: true,
          isCancelled: true,
          // priceAtOrder + the piecesPerSetFor shape are needed to snapshot preTaxAmount below —
          // same fields listOrders' own totalValue reads, just qtySetsPacked-based instead of
          // qtySetsRequested-based (rule 101 — billing commits against what was actually packed,
          // the same basis BillOrderDetail.jsx's frontend total has always used for this screen).
          priceAtOrder: true,
          bundle: { select: { product: { select: { isKids: true, sizes: { select: { sizeLabel: true, qty: true } } } } } },
        },
      },
    },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (order.status !== 'PACKED') {
    return sendError(res, 409, 'ORDER_NOT_PACKED', `Order must be PACKED to bill — current status is ${order.status}`);
  }
  // Same reasoning as packOrder's guard: dropping off the worklist is display, not enforcement.
  // Billing a cancelled order would deduct real stock for goods nobody is sending.
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order has been cancelled and can no longer be billed');
  }

  // preTaxAmount snapshot (rule 101) — qtySetsPacked × piecesPerSet × priceAtOrder, summed
  // across non-cancelled lines only. Computed from THIS SAME already-fetched order.lineItems,
  // not a second query — a cancelled line's qtySetsPacked is irrelevant either way since it's
  // filtered out here, same as it's excluded from linesToDeduct below.
  const preTaxAmount = order.lineItems
    .filter((li) => !li.isCancelled)
    .reduce((sum, li) => sum + li.qtySetsPacked * piecesPerSetFor(li.bundle.product) * Number(li.priceAtOrder), 0);

  // Rule 101's exact three-step order: discount first, then GST on the POST-discount amount —
  // never the original preTaxAmount. Never trusts a client-computed final number; these are the
  // only figures actually written below.
  const finalAmount = discountApplicable ? preTaxAmount - (preTaxAmount * discountPercent) / 100 : preTaxAmount;
  const actualPayable = gstApplicable ? finalAmount + (finalAmount * gstPercent) / 100 : finalAmount;

  // Deduct against qtySetsPacked, NOT qtySetsRequested — packing is the physical count of what
  // actually went in the box, so that's the number billing commits against. A short-packed line
  // moves only what was really packed; the shortfall was already recorded as its own
  // SHORT_PACKED OrderAdjustment at pack time and needs no second entry here.
  // Cancelled lines are excluded outright: nothing is deducted for them, and they consequently
  // can't make an order un-billable either — cancelling a line whose stock ran short is exactly
  // how an owner unblocks the rest of the order.
  const linesToDeduct = order.lineItems.filter((li) => !li.isCancelled && li.qtySetsPacked > 0);

  const bundleIds = [...new Set(linesToDeduct.map((li) => li.bundleId))];
  const stockRows = await prisma.stock.findMany({
    where: { bundleId: { in: bundleIds }, qtySets: { gt: 0 } },
    select: { id: true, bundleId: true, qtySets: true, location: { select: { name: true } } },
  });
  const stockByBundle = new Map();
  for (const s of stockRows) {
    if (!stockByBundle.has(s.bundleId)) stockByBundle.set(s.bundleId, []);
    stockByBundle.get(s.bundleId).push(s);
  }
  for (const rows of stockByBundle.values()) {
    rows.sort((a, b) => a.location.name.localeCompare(b.location.name));
  }

  // Everything-or-nothing pre-check — if any single line can't be fully covered by total available
  // stock across its locations, reject the WHOLE request before touching the database, rather than
  // partially deducting some lines and then discovering a later one comes up short. Same atomicity
  // guarantee order creation already makes.
  //
  // Unlike at pack time, this genuinely CAN fire in normal use: stock may have moved between
  // packing and billing (another order billed first, a transfer, a correction). That's exactly the
  // race this rejects cleanly instead of silently overselling.
  // EVERY line is checked before returning, not just up to the first failure. Returning on the
  // first one made a multi-line shortage feel like whack-a-mole: the caller fixes one line, retries,
  // and discovers the next one — with no way to see the true scope of the problem up front. The
  // full list costs nothing extra here (the stock is already resolved in memory) and lets a client
  // show all of it at once.
  const insufficientLines = [];
  for (const li of linesToDeduct) {
    const available = (stockByBundle.get(li.bundleId) || []).reduce((sum, s) => sum + s.qtySets, 0);
    if (available < li.qtySetsPacked) {
      insufficientLines.push({
        lineItemId: li.id,
        bundleId: li.bundleId,
        needed: li.qtySetsPacked,
        available,
      });
    }
  }
  if (insufficientLines.length > 0) {
    const count = insufficientLines.length;
    return sendError(
      res,
      409,
      'INSUFFICIENT_STOCK',
      count === 1
        ? `Not enough stock to bill ${insufficientLines[0].needed} sets for line ${insufficientLines[0].lineItemId} (available: ${insufficientLines[0].available})`
        : `${count} lines don't have enough stock to bill`,
      // Sibling field alongside `error`, which sendError passes through and the frontend's
      // ApiError surfaces as `.extra` — same shape requirePin already uses for attemptsRemaining.
      { insufficientLines }
    );
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      for (const li of linesToDeduct) {
        let remaining = li.qtySetsPacked;
        const rows = stockByBundle.get(li.bundleId) || [];

        for (const stockRow of rows) {
          if (remaining <= 0) break;
          const draw = Math.min(remaining, stockRow.qtySets);
          if (draw <= 0) continue;

          // Same guarded-decrement idiom as Transfer (transferController.js) — the "is there
          // enough?" check and the decrement are one atomic statement via the qtySets: { gte }
          // WHERE clause, so a genuine concurrent race (another bill landing between our read
          // above and this write) can't drive stock negative. count === 0 means the pre-check's
          // read went stale; that's what this guard exists to catch, and the whole transaction
          // rolls back rather than applying a partial deduction.
          const decremented = await tx.stock.updateMany({
            where: { id: stockRow.id, qtySets: { gte: draw } },
            data: { qtySets: { decrement: draw } },
          });
          if (decremented.count === 0) {
            const err = new Error(`Stock at a location for line ${li.id} changed concurrently — billing aborted`);
            err.isInsufficientStock = true;
            throw err;
          }

          await tx.transaction.create({
            data: {
              stockId: stockRow.id,
              userId: req.user.id,
              type: 'STOCK_OUT',
              qtySets: draw,
              orderLineItemId: li.id,
            },
          });

          remaining -= draw;
        }

        if (remaining > 0) {
          const err = new Error(`Stock for line ${li.id} changed concurrently — billing aborted`);
          err.isInsufficientStock = true;
          throw err;
        }
      }

      await tx.order.update({
        where: { id },
        data: {
          status: 'BILLED',
          billedAt: new Date(),
          // Written exactly once, here, the moment billing actually happens — never touched by
          // any other endpoint. discountPercent/gstPercent are stored null when their own
          // applicable flag is false, regardless of what the client sent, so a stray percent
          // value can never look "applied" later just because it happened to be present in the
          // request body.
          discountApplicable,
          discountPercent: discountApplicable ? discountPercent : null,
          gstApplicable,
          gstPercent: gstApplicable ? gstPercent : null,
          preTaxAmount,
          finalAmount,
          actualPayable,
          // Reference tag only — null when not supplied, and correctable afterwards via
          // PATCH /api/orders/:id/bill-no (unlike every money field above, which rule 23 locks
          // for good the moment this write lands).
          billNo: billNo.provided ? billNo.value : null,
        },
      });
      // Routine forward progress, not a correction — reason stays null, same as every other
      // status transition (03_DATABASE_SCHEMA.md §2's "Hard rules to enforce").
      await tx.orderAdjustment.create({
        data: {
          orderId: id,
          changedById: req.user.id,
          field: 'status',
          oldValue: 'PACKED',
          newValue: 'BILLED',
          reason: null,
        },
      });

      return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
    });
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 409, 'INSUFFICIENT_STOCK', err.message);
    }
    throw err;
  }

  res.json(orderDetailToResponse(updated, req.user.role));
}

// PATCH /api/orders/:id/ship — any authenticated role (🔒). Same staff-primary reasoning as
// packOrder above (rule 63). No line-item changes — purely a status transition.
async function shipOrder(req, res) {
  const { id } = req.params;

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true, isCancelled: true } });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order has been cancelled and can no longer be dispatched');
  }
  if (order.status !== 'BILLED') {
    return sendError(res, 409, 'ORDER_NOT_BILLED', `Order must be BILLED to dispatch — current status is ${order.status}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: { status: 'SHIPPED', shippedAt: new Date() },
    });
    await tx.orderAdjustment.create({
      data: {
        orderId: id,
        changedById: req.user.id,
        field: 'status',
        oldValue: 'BILLED',
        newValue: 'SHIPPED',
        reason: null,
      },
    });
    return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  });

  res.json(orderDetailToResponse(updated, req.user.role));
}

// Shared by updateOrderLines below AND the Cancellation endpoints further down — both are the
// same "still-editable" window rule 23 defines: everything is locked from Billed on, since stock
// has already moved and any change from that point would have to be a Return, not an edit.
// Declared once, up here, so both sections read from the exact same list rather than two copies
// that could silently drift out of sync.
const CANCELLABLE_STATUSES = ['PLACED', 'PACKED'];

// PATCH /api/orders/:id/lines — OWNER only (👑), no PIN (routes/orders.js). Edits a committed
// order's lines: change an existing (non-cancelled) line's requested quantity, add a brand-new
// line, or both in one request — an order edit is usually one real event, not two API calls.
//
// Allowed while PLACED or PACKED, same two-status window as cancellation (CANCELLABLE_STATUSES
// above).
//
// If the order is currently PACKED, this edit reverts it to PLACED — logged as its own
// OrderAdjustment (field: 'status', reason: 'ORDER_EDITED'), not a silent field flip. Safe to do
// unconditionally: Pack no longer touches stock (2026-08-17), so nothing can double-deduct from
// re-packing, and Bill re-checks real stock availability at bill time regardless of what pack
// last recorded.
//
// qtySetsPacked reset is TOUCHED-LINE-ONLY, not whole-order (see LEARNING_LOG.md for the
// investigation this was based on): the edited/added line's qtySetsPacked clears to 0 because a
// packed count against the OLD quantity is meaningless once that quantity has changed, but every
// OTHER live line's qtySetsPacked is left exactly as it was — confirmed safe because nothing in
// the frontend reads that field for a PLACED order, and PATCH /:id/pack fully overwrites every
// live line's value the next time this order is actually re-packed regardless.
async function updateOrderLines(req, res) {
  const { id } = req.params;
  const { lineChanges, newLines } = req.body;

  if (lineChanges !== undefined && !Array.isArray(lineChanges)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lineChanges must be an array');
  }
  if (newLines !== undefined && !Array.isArray(newLines)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'newLines must be an array');
  }
  const hasLineChanges = Array.isArray(lineChanges) && lineChanges.length > 0;
  const hasNewLines = Array.isArray(newLines) && newLines.length > 0;
  if (!hasLineChanges && !hasNewLines) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'At least one of lineChanges or newLines must be a non-empty array');
  }

  if (hasLineChanges) {
    const seen = new Set();
    for (const lc of lineChanges) {
      if (!lc || !lc.lineItemId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Each entry in lineChanges requires a lineItemId');
      }
      if (!Number.isInteger(lc.qtySetsRequested) || lc.qtySetsRequested <= 0) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Each entry in lineChanges requires a positive integer qtySetsRequested');
      }
      if (seen.has(lc.lineItemId)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `lineItemId ${lc.lineItemId} submitted more than once in lineChanges`);
      }
      seen.add(lc.lineItemId);
    }
  }
  if (hasNewLines) {
    for (const nl of newLines) {
      if (!nl || !nl.bundleId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Each entry in newLines requires a bundleId');
      }
      if (!Number.isInteger(nl.qtySetsRequested) || nl.qtySetsRequested <= 0) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Each entry in newLines requires a positive integer qtySetsRequested');
      }
    }
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isCancelled: true,
      lineItems: { select: { id: true, qtySetsRequested: true, isCancelled: true } },
    },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return sendError(
      res,
      409,
      'ORDER_NOT_EDITABLE',
      `Lines can only be edited while an order is Placed or Packed — this order is ${order.status}`
    );
  }
  // Same reasoning as packOrder/billOrder's own guard: dropping off a worklist is a display
  // concern, not enforcement — a direct call must still be rejected.
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order has been cancelled and can no longer be edited');
  }

  const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
  const resolvedChanges = [];
  if (hasLineChanges) {
    for (const lc of lineChanges) {
      const line = lineById.get(lc.lineItemId);
      if (!line) {
        return sendError(res, 404, 'LINE_ITEM_NOT_FOUND', `No line ${lc.lineItemId} on order ${id}`);
      }
      if (line.isCancelled) {
        return sendError(res, 409, 'LINE_ALREADY_CANCELLED', `Line ${lc.lineItemId} is cancelled and cannot be edited`);
      }
      if (lc.qtySetsRequested === line.qtySetsRequested) {
        return sendError(
          res,
          400,
          'VALIDATION_ERROR',
          `Nothing to change for line ${lc.lineItemId} — qtySetsRequested is already ${line.qtySetsRequested}`
        );
      }
      resolvedChanges.push({ lineItemId: lc.lineItemId, oldQty: line.qtySetsRequested, newQty: lc.qtySetsRequested });
    }
  }

  // priceAtOrder for a new line is resolved HERE, from Product.sellingPrice at this exact moment
  // — never trusted from the request body, same principle createOrder already applies.
  // productNameSnapshot (2026-08-28) rides along on the identical read, same as createOrder:
  // a line added to an existing order is still a NEW line, so it snapshots the name as of now,
  // not as of whenever the order it's joining was originally placed.
  const resolvedNewLines = [];
  if (hasNewLines) {
    const bundleIds = [...new Set(newLines.map((nl) => nl.bundleId))];
    const bundles = await prisma.bundle.findMany({
      where: { id: { in: bundleIds } },
      select: { id: true, product: { select: { sellingPrice: true, name: true } } },
    });
    const bundleById = new Map(bundles.map((b) => [b.id, b]));
    for (const nl of newLines) {
      const bundle = bundleById.get(nl.bundleId);
      if (!bundle) {
        return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${nl.bundleId}`);
      }
      if (bundle.product.sellingPrice == null) {
        return sendError(
          res,
          400,
          'UNPRICED_PRODUCT',
          `The article for bundle ${nl.bundleId} has no selling price set yet and cannot be ordered`
        );
      }
      resolvedNewLines.push({
        bundleId: nl.bundleId,
        qtySetsRequested: nl.qtySetsRequested,
        priceAtOrder: bundle.product.sellingPrice,
        productNameSnapshot: bundle.product.name,
      });
    }
  }

  const wasPacked = order.status === 'PACKED';

  const updated = await prisma.$transaction(async (tx) => {
    for (const change of resolvedChanges) {
      await tx.orderLineItem.update({
        where: { id: change.lineItemId },
        data: { qtySetsRequested: change.newQty, qtySetsPacked: 0 },
      });
      await tx.orderAdjustment.create({
        data: {
          orderId: id,
          lineItemId: change.lineItemId,
          changedById: req.user.id,
          field: 'qtySetsRequested',
          oldValue: String(change.oldQty),
          newValue: String(change.newQty),
          reason: 'QUANTITY_CHANGED',
        },
      });
    }

    for (const nl of resolvedNewLines) {
      const created = await tx.orderLineItem.create({
        data: {
          orderId: id,
          bundleId: nl.bundleId,
          qtySetsRequested: nl.qtySetsRequested,
          priceAtOrder: nl.priceAtOrder,
          productNameSnapshot: nl.productNameSnapshot,
        },
      });
      await tx.orderAdjustment.create({
        data: {
          orderId: id,
          lineItemId: created.id,
          changedById: req.user.id,
          field: 'qtySetsRequested',
          // '0' — there is no real "old" value for a line that didn't exist before this request;
          // treating "didn't exist" as "requested 0 of it" lets this render through the same
          // qtySetsRequested-change display logic QUANTITY_CHANGED uses.
          oldValue: '0',
          newValue: String(nl.qtySetsRequested),
          reason: 'LINE_ADDED',
        },
      });
    }

    if (wasPacked) {
      await tx.order.update({ where: { id }, data: { status: 'PLACED', packedAt: null } });
      await tx.orderAdjustment.create({
        data: {
          orderId: id,
          changedById: req.user.id,
          field: 'status',
          oldValue: 'PACKED',
          newValue: 'PLACED',
          reason: 'ORDER_EDITED',
        },
      });
    }

    return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  });

  res.json(orderDetailToResponse(updated, req.user.role));
}

// --- Cancellation (added 2026-08-18) ---------------------------------------------------------
// Both endpoints below are OWNER ONLY (routes/orders.js), and both are allowed only while the
// order is PLACED or PACKED (CANCELLABLE_STATUSES, declared above updateOrderLines — shared with
// it since it's the identical editability window). From Billed onward rule 23's hard lock
// applies: stock has already moved and the order is immutable, so a cancellation there would
// have to be a Return, not an edit. Neither endpoint ever rewrites a quantity —
// qtySetsRequested/qtySetsPacked stay exactly as they were, so the original ask and count remain
// readable forever; only a flag flips.

// PATCH /api/orders/:id/lines/:lineItemId/cancel — OWNER only (👑).
async function cancelOrderLine(req, res) {
  const { id, lineItemId } = req.params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, isCancelled: true, lineItems: { select: { id: true, isCancelled: true } } },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return sendError(
      res,
      409,
      'ORDER_NOT_CANCELLABLE',
      `Lines can only be cancelled while an order is Placed or Packed — this order is ${order.status}`
    );
  }
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order is already cancelled in full');
  }

  const line = order.lineItems.find((li) => li.id === lineItemId);
  if (!line) {
    return sendError(res, 404, 'LINE_ITEM_NOT_FOUND', `No line ${lineItemId} on order ${id}`);
  }
  if (line.isCancelled) {
    return sendError(res, 409, 'LINE_ALREADY_CANCELLED', 'This line is already cancelled');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.update({ where: { id: lineItemId }, data: { isCancelled: true } });
    await tx.orderAdjustment.create({
      data: {
        orderId: id,
        lineItemId,
        changedById: req.user.id,
        field: 'isCancelled',
        oldValue: 'false',
        newValue: 'true',
        // This enum value has existed since the Phase 2 reconciliation, reserved for exactly
        // this — a real business cancellation, not a data-entry correction.
        reason: 'ORDER_CANCELLED',
      },
    });
    return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  });

  // Deliberately NOT auto-cancelling the order when its last live line goes: cancelling every
  // line one by one and cancelling the order are different intents, and inferring the second
  // from the first would take an irreversible decision the owner never actually made. An order
  // with zero live lines simply bills nothing — see billOrder's linesToDeduct.
  res.json(orderDetailToResponse(updated, req.user.role));
}

// PATCH /api/orders/:id/cancel — OWNER only (👑).
async function cancelOrder(req, res) {
  const { id } = req.params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, isCancelled: true },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return sendError(
      res,
      409,
      'ORDER_NOT_CANCELLABLE',
      `An order can only be cancelled while Placed or Packed — this one is ${order.status}`
    );
  }
  if (order.isCancelled) {
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order is already cancelled');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { isCancelled: true } });
    await tx.orderAdjustment.create({
      data: {
        orderId: id,
        // lineItemId stays null — this is an order-level event, same shape a status transition uses.
        changedById: req.user.id,
        field: 'isCancelled',
        oldValue: 'false',
        newValue: 'true',
        reason: 'ORDER_CANCELLED',
      },
    });
    return tx.order.findUnique({ where: { id }, select: orderDetailSelect(req.user.role) });
  });

  // Line items are deliberately left alone. The order-level flag is what every guard and every
  // worklist reads; stamping isCancelled onto all 13 lines as well would be redundant state that
  // could later disagree with the order flag, and would destroy the distinction between "this
  // one line was cancelled" and "the whole order was".
  res.json(orderDetailToResponse(updated, req.user.role));
}

// PATCH /api/orders/:id/bill-no — OWNER only (👑), no PIN. Corrects (or clears) the reference tag
// captured at billing time, nothing else. Added 2026-08-30.
//
// A SEPARATE endpoint rather than a branch inside billOrder or updateOrderLines, for two reasons:
// billOrder is a one-shot irreversible transition that also deducts stock — it can only ever run
// once per order, so it structurally cannot host a later correction — and updateOrderLines is
// explicitly about order CONTENTS, which rule 23 freezes at billing. This endpoint touches
// neither: no stock movement, no status change, no money field, no OrderAdjustment row (that
// table records changes to the order's real content and status, and a reference tag is neither —
// writing one would put a non-event into the History feed).
//
// No PIN, deliberately, unlike the factory-side debit edit: requirePin guards actions that move
// money (rules 71/81/96), and this one provably cannot — `data` below contains exactly one key,
// billNo, so there is no request shape that reaches this handler and changes an amount.
//
// Only meaningful once an order has actually been billed, so a not-yet-billed order is rejected
// rather than silently accepting a tag that would sit invisibly on a PLACED/PACKED order.
async function updateOrderBillNo(req, res) {
  const { id } = req.params;

  const billNo = normalizeBillNo(req.body?.billNo);
  if (!billNo.ok) {
    return sendError(res, 400, 'VALIDATION_ERROR', billNo.message);
  }
  if (!billNo.provided) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'billNo is required');
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, billedAt: true },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (!order.billedAt) {
    return sendError(
      res,
      409,
      'ORDER_NOT_BILLED',
      'A bill number can only be set on an order that has been billed'
    );
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { billNo: billNo.value },
    select: orderDetailSelect(req.user.role),
  });

  res.json(orderDetailToResponse(updated, req.user.role));
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  packOrder,
  billOrder,
  shipOrder,
  updateOrderLines,
  cancelOrderLine,
  cancelOrder,
  updateOrderBillNo,
};
