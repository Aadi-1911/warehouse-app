const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

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
  bundle: {
    select: {
      product: { select: { id: true, articleNo: true, name: true } },
      color: { select: { id: true, name: true } },
    },
  },
};

const ORDER_DETAIL_SELECT = {
  id: true,
  partyId: true,
  party: { select: { name: true } },
  status: true,
  createdById: true,
  createdBy: { select: { name: true } },
  createdAt: true,
  packedAt: true,
  billedAt: true,
  shippedAt: true,
  isCancelled: true,
  lineItems: { select: LINE_ITEM_SELECT },
};

function lineItemToResponse(li) {
  return {
    id: li.id,
    bundleId: li.bundleId,
    productId: li.bundle.product.id,
    productArticleNo: li.bundle.product.articleNo,
    productName: li.bundle.product.name,
    colorId: li.bundle.color.id,
    colorName: li.bundle.color.name,
    qtySetsRequested: li.qtySetsRequested,
    qtySetsPacked: li.qtySetsPacked,
    isCancelled: li.isCancelled,
    priceAtOrder: li.priceAtOrder,
  };
}

function orderDetailToResponse(o) {
  return {
    id: o.id,
    partyId: o.partyId,
    partyName: o.party.name,
    status: o.status,
    createdById: o.createdById,
    createdByName: o.createdBy.name,
    createdAt: o.createdAt,
    packedAt: o.packedAt,
    billedAt: o.billedAt,
    shippedAt: o.shippedAt,
    isCancelled: o.isCancelled,
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
    select: { id: true, product: { select: { sellingPrice: true } } },
  });
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  // priceAtOrder is computed HERE, server-side, from Product.sellingPrice at this exact
  // moment — never trusted from the request body, same principle as Transaction.
  // costPriceSnapshot. Resolved fully before any DB write, so a bad bundleId or an unpriced
  // product anywhere in the array rejects the whole request with zero rows created.
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
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        partyId,
        createdById: req.user.id,
        lineItems: { create: resolvedLineItems },
      },
    });
    // Re-read inside the transaction, with the full display-ready select, so the response
    // reflects the true post-write state rather than being reassembled in JS from inputs.
    return tx.order.findUnique({ where: { id: order.id }, select: ORDER_DETAIL_SELECT });
  });

  res.status(201).json(orderDetailToResponse(created));
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
      status: true,
      createdAt: true,
      // The stage timestamps ride along so a status-scoped list can show the date that actually
      // matters for ITS stage — Bill Orders (status=PACKED) shows when it was packed, Ship Order
      // (status=BILLED) shows when it was billed. createdAt alone can't serve both.
      packedAt: true,
      billedAt: true,
      shippedAt: true,
      lineItems: { select: { qtySetsRequested: true, priceAtOrder: true } },
    },
  });

  const response = orders.map((o) => ({
    id: o.id,
    partyId: o.partyId,
    partyName: o.party.name,
    status: o.status,
    createdAt: o.createdAt,
    packedAt: o.packedAt,
    billedAt: o.billedAt,
    shippedAt: o.shippedAt,
    lineItemCount: o.lineItems.length,
    totalValue: o.lineItems.reduce((sum, li) => sum + li.qtySetsRequested * Number(li.priceAtOrder), 0),
  }));

  res.json(response);
}

// GET /api/orders/:id — any authenticated role (🔒). Full detail, all line items, each with
// the article/color info actually needed to display it — same shape POST returns.
async function getOrder(req, res) {
  const { id } = req.params;

  const order = await prisma.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }

  res.json(orderDetailToResponse(order));
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

    return tx.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
  });

  res.json(orderDetailToResponse(updated));
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
// No body. No formal Bill document/invoice entity exists yet (amounts, GST, a printable doc are
// an explicitly separate later task) — this is a pure status-transition-plus-deduction endpoint,
// structurally the same shape as shipOrder below.
async function billOrder(req, res) {
  const { id } = req.params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      lineItems: { select: { id: true, bundleId: true, qtySetsPacked: true, isCancelled: true } },
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
        data: { status: 'BILLED', billedAt: new Date() },
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

      return tx.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
    });
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 409, 'INSUFFICIENT_STOCK', err.message);
    }
    throw err;
  }

  res.json(orderDetailToResponse(updated));
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
    return sendError(res, 409, 'ORDER_CANCELLED', 'This order has been cancelled and can no longer be shipped');
  }
  if (order.status !== 'BILLED') {
    return sendError(res, 409, 'ORDER_NOT_BILLED', `Order must be BILLED to ship — current status is ${order.status}`);
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
    return tx.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
  });

  res.json(orderDetailToResponse(updated));
}

// --- Cancellation (added 2026-08-18) ---------------------------------------------------------
// Both endpoints below are OWNER ONLY (routes/orders.js), and both are allowed only while the
// order is PLACED or PACKED. From Billed onward rule 23's hard lock applies: stock has already
// moved and the order is immutable, so a cancellation there would have to be a Return, not an
// edit. Neither endpoint ever rewrites a quantity — qtySetsRequested/qtySetsPacked stay exactly
// as they were, so the original ask and count remain readable forever; only a flag flips.
const CANCELLABLE_STATUSES = ['PLACED', 'PACKED'];

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
    return tx.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
  });

  // Deliberately NOT auto-cancelling the order when its last live line goes: cancelling every
  // line one by one and cancelling the order are different intents, and inferring the second
  // from the first would take an irreversible decision the owner never actually made. An order
  // with zero live lines simply bills nothing — see billOrder's linesToDeduct.
  res.json(orderDetailToResponse(updated));
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
    return tx.order.findUnique({ where: { id }, select: ORDER_DETAIL_SELECT });
  });

  // Line items are deliberately left alone. The order-level flag is what every guard and every
  // worklist reads; stamping isCancelled onto all 13 lines as well would be redundant state that
  // could later disagree with the order flag, and would destroy the distinction between "this
  // one line was cancelled" and "the whole order was".
  res.json(orderDetailToResponse(updated));
}

module.exports = { createOrder, listOrders, getOrder, packOrder, billOrder, shipOrder, cancelOrderLine, cancelOrder };
