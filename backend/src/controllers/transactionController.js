const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const VALID_TYPES = ['STOCK_IN', 'STOCK_OUT', 'SAMPLE_OUT', 'SAMPLE_RETURN'];

// Maps a transaction type to (a) the Prisma update it applies and (b) the WHERE-clause guard
// that must hold for the update to be allowed to run at all. The guard is what makes the
// negative-quantity check atomic with the write itself — see the up-front reasoning in
// LEARNING_LOG.md for why a separate read-then-check-then-write would be race-prone here.
function buildStockUpdate(type, qtySets) {
  switch (type) {
    case 'STOCK_IN':
      return { data: { qtySets: { increment: qtySets } }, guard: {} };
    case 'STOCK_OUT':
      return {
        data: { qtySets: { decrement: qtySets } },
        guard: { qtySets: { gte: qtySets } },
        insufficientField: 'qtySets',
      };
    case 'SAMPLE_OUT':
      return {
        data: { qtySets: { decrement: qtySets }, qtyReservedForSample: { increment: qtySets } },
        guard: { qtySets: { gte: qtySets } },
        insufficientField: 'qtySets',
      };
    case 'SAMPLE_RETURN':
      return {
        data: { qtyReservedForSample: { decrement: qtySets }, qtySets: { increment: qtySets } },
        guard: { qtyReservedForSample: { gte: qtySets } },
        insufficientField: 'qtyReservedForSample',
      };
    default:
      throw new Error(`Unhandled transaction type: ${type}`);
  }
}

// POST /api/transactions — any authenticated role (🔒). The only way Stock quantities change
// (02_ARCHITECTURE.md §5, CLAUDE.md's non-negotiable rules) — no direct Stock write endpoint
// exists anywhere else in this API.
async function createTransaction(req, res) {
  const { bundleId, locationId, type, qtySets, note } = req.body;

  if (!bundleId || !locationId || !type) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'bundleId, locationId, and type are required');
  }
  if (!VALID_TYPES.includes(type)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (!Number.isInteger(qtySets) || qtySets <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'qtySets must be a positive integer');
  }

  // Confirms the (Product, Color) pairing is real — a Bundle can only exist if it was created
  // through POST /api/bundles, which already validated both sides existed at that time.
  const bundle = await prisma.bundle.findUnique({ where: { id: bundleId } });
  if (!bundle) {
    return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${bundleId}`);
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${locationId}`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Find-or-create: a bundle/location pairing with no prior activity has no Stock row yet.
      // `update: {}` never touches quantities on an existing row — only the create branch sets them.
      const stock = await tx.stock.upsert({
        where: { bundleId_locationId: { bundleId, locationId } },
        update: {},
        create: { bundleId, locationId, qtySets: 0, qtyReservedForSample: 0 },
      });

      const { data, guard, insufficientField } = buildStockUpdate(type, qtySets);

      const updateResult = await tx.stock.updateMany({
        where: { id: stock.id, ...guard },
        data,
      });

      if (updateResult.count === 0) {
        const err = new Error(
          `This ${type} would take ${insufficientField} negative for this bundle/location`
        );
        err.isInsufficientStock = true;
        throw err;
      }

      // Re-read inside the same transaction so the response reflects the true post-write
      // values, not a value computed in JS from a possibly-stale earlier read.
      const updatedStock = await tx.stock.findUnique({ where: { id: stock.id } });

      const transaction = await tx.transaction.create({
        data: { stockId: stock.id, userId: req.user.id, type, qtySets, note: note || null },
      });

      return { transaction, updatedStock };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 400, 'INSUFFICIENT_STOCK', err.message);
    }
    throw err;
  }
}

// GET /api/transactions — any authenticated role (🔒). Audit/history view — see
// LEARNING_LOG.md for why the response shape below (userName/productArticleNo/colorName/
// locationName alongside their raw IDs) is a design decision, not literally spelled out in
// 04_API_SPEC.md the way GET /api/stock's shape was.
async function listTransactions(req, res) {
  const { bundleId, locationId, userId, from, to } = req.query;

  const where = {};
  if (userId) where.userId = userId;
  if (bundleId || locationId) {
    where.stock = {};
    if (bundleId) where.stock.bundleId = bundleId;
    if (locationId) where.stock.locationId = locationId;
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

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      qtySets: true,
      note: true,
      createdAt: true,
      userId: true,
      user: { select: { name: true } },
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
    },
  });

  const response = transactions.map((t) => ({
    id: t.id,
    type: t.type,
    qtySets: t.qtySets,
    note: t.note,
    createdAt: t.createdAt,
    userId: t.userId,
    userName: t.user.name,
    bundleId: t.stock.bundleId,
    productArticleNo: t.stock.bundle.product.articleNo,
    colorName: t.stock.bundle.color.name,
    locationId: t.stock.locationId,
    locationName: t.stock.location.name,
  }));

  res.json(response);
}

module.exports = { createTransaction, listTransactions };
