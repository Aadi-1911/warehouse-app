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

module.exports = { createOrder, listOrders, getOrder };
