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
  if (status) where.status = status;
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
      lineItems: { select: { qtySetsRequested: true, priceAtOrder: true } },
    },
  });

  const response = orders.map((o) => ({
    id: o.id,
    partyId: o.partyId,
    partyName: o.party.name,
    status: o.status,
    createdAt: o.createdAt,
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
// Stock deduction picks Location rows FIFO (rule 64) in alphabetical order by Location.name.
// There's no existing "canonical" ordering for Locations anywhere in this codebase to defer to —
// listLocations has no orderBy at all, and Transfer's fromLocationId is a human's explicit pick,
// never an auto-selected one. The one place this app already had to answer "what order do
// multiple Locations go in" is Live Stock's own display grouping
// (frontend/src/pages/LiveStock.jsx), which sorts by locationName.localeCompare(...) — i.e.
// alphabetical. Reusing that here rather than inventing a second convention (e.g. createdAt,
// which has no established precedent and no meaning a human could ever explain if asked "why did
// this pack draw from Gurgaon before Delhi").
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
    select: { id: true, status: true, lineItems: { select: { id: true, bundleId: true, qtySetsRequested: true } } },
  });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
  }
  if (order.status !== 'PLACED') {
    return sendError(res, 409, 'ORDER_NOT_PLACED', `Order must be PLACED to pack — current status is ${order.status}`);
  }

  // Every submitted lineItemId must belong to this order, and every line ON this order must be
  // covered by exactly one submitted entry — a partial submission would leave some lines with
  // stale qtySetsPacked while the order still moves to PACKED, silently pretending they were
  // handled. REJECT (400) rather than silently defaulting missing lines to 0, same "fail loudly"
  // reasoning the task gives for the packed-quantity range check below.
  const lineById = new Map(order.lineItems.map((li) => [li.id, li]));
  const submittedIds = new Set();
  for (const sl of submittedLines) {
    if (!lineById.has(sl.lineItemId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `lineItemId ${sl.lineItemId} does not belong to order ${id}`);
    }
    if (submittedIds.has(sl.lineItemId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `lineItemId ${sl.lineItemId} submitted more than once`);
    }
    submittedIds.add(sl.lineItemId);
  }
  if (submittedIds.size !== order.lineItems.length) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lineItems must include exactly one entry for every line on this order');
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

  // Resolve, for every distinct bundle referenced, all Stock rows holding it — read-only, before
  // any write — same "resolve everything, then validate" shape createOrder above already uses.
  const bundleIds = [...new Set(submittedLines.map((sl) => lineById.get(sl.lineItemId).bundleId))];
  const stockRows = await prisma.stock.findMany({
    where: { bundleId: { in: bundleIds }, qtySets: { gt: 0 } },
    select: { id: true, bundleId: true, locationId: true, qtySets: true, location: { select: { name: true } } },
  });
  const stockByBundle = new Map();
  for (const s of stockRows) {
    if (!stockByBundle.has(s.bundleId)) stockByBundle.set(s.bundleId, []);
    stockByBundle.get(s.bundleId).push(s);
  }
  for (const rows of stockByBundle.values()) {
    rows.sort((a, b) => a.location.name.localeCompare(b.location.name));
  }

  // Everything-or-nothing pre-check (rule: same atomicity guarantee as order creation) — if any
  // single line can't be fully covered by total available stock across its locations, reject the
  // WHOLE request before touching the database, rather than partially deducting some lines and
  // then discovering a later one comes up short.
  for (const sl of submittedLines) {
    if (sl.qtySetsPacked === 0) continue;
    const available = (stockByBundle.get(lineById.get(sl.lineItemId).bundleId) || [])
      .reduce((sum, s) => sum + s.qtySets, 0);
    if (available < sl.qtySetsPacked) {
      return sendError(
        res,
        409,
        'INSUFFICIENT_STOCK',
        `Not enough stock to pack ${sl.qtySetsPacked} sets for line ${sl.lineItemId} (available: ${available})`
      );
    }
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      for (const sl of submittedLines) {
        const line = lineById.get(sl.lineItemId);
        let remaining = sl.qtySetsPacked;
        const rows = stockByBundle.get(line.bundleId) || [];

        for (const stockRow of rows) {
          if (remaining <= 0) break;
          const draw = Math.min(remaining, stockRow.qtySets);
          if (draw <= 0) continue;

          // Same guarded-decrement idiom as Transfer (transferController.js) — the "is there
          // enough?" check and the decrement are one atomic statement via the qtySets: { gte }
          // WHERE clause, so a genuine concurrent race (another pack/transaction landing between
          // our read above and this write) can't drive stock negative. count === 0 here means the
          // pre-check's read was stale; that's the race the everything-or-nothing check above is
          // meant to catch, but this guard is what actually prevents corruption if it slips through.
          const decremented = await tx.stock.updateMany({
            where: { id: stockRow.id, qtySets: { gte: draw } },
            data: { qtySets: { decrement: draw } },
          });
          if (decremented.count === 0) {
            const err = new Error(`Stock at a location for line ${sl.lineItemId} changed concurrently — pack aborted`);
            err.isInsufficientStock = true;
            throw err;
          }

          await tx.transaction.create({
            data: {
              stockId: stockRow.id,
              userId: req.user.id,
              type: 'STOCK_OUT',
              qtySets: draw,
              orderLineItemId: line.id,
            },
          });

          remaining -= draw;
        }

        if (remaining > 0) {
          // Same race window as above — the pre-check said enough was available, but a concurrent
          // write drew it down first. Whole request aborts, nothing partially applied.
          const err = new Error(`Stock for line ${sl.lineItemId} changed concurrently — pack aborted`);
          err.isInsufficientStock = true;
          throw err;
        }

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

  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!order) {
    return sendError(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id}`);
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

module.exports = { createOrder, listOrders, getOrder, packOrder, shipOrder };
