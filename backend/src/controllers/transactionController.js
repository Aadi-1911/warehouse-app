const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { applyStockMovement } = require('../utils/stock');

const prisma = new PrismaClient();

// Deliberately narrower than the TransactionType enum. DEFECT_RETURN and PARTY_RETURN are
// declared in the enum so a later phase's rows are insertable against the existing database
// type, but neither has stock-movement semantics designed yet — accepting them here would mean
// guessing at how they move stock. Rejecting them until they're built is the honest behaviour;
// the alternative is an endpoint that silently applies the wrong movement to real inventory.
//
// TRANSFER_OUT/TRANSFER_IN are excluded for a DIFFERENT and permanent reason: they are fully
// built, but they are only ever valid as a PAIR, created together atomically by
// POST /api/transfers. Accepting a lone TRANSFER_OUT here would let stock leave one location
// without ever arriving at the other — the exact invariant the Transfer model exists to
// guarantee. These two stay rejected here even now that transfers work.
// (SAMPLE_OUT/SAMPLE_RETURN were removed outright — 05_BUSINESS_RULES.md rule 84.)
const VALID_TYPES = ['STOCK_IN', 'STOCK_OUT'];

// Never returned by any endpoint (04_API_SPEC.md's POST/GET /api/transactions response shapes
// both omit it) — it exists purely for the /api/factories/:id/payable aggregation to read
// directly. Explicit select on every Transaction create/read keeps it from ever leaking out
// through this controller regardless of role, the same "select, don't strip" guarantee used
// for costPrice on Products.
const TRANSACTION_RESPONSE_SELECT = {
  id: true,
  stockId: true,
  userId: true,
  type: true,
  qtySets: true,
  note: true,
  createdAt: true,
};

// The upsert-then-guarded-update this endpoint used to define inline now lives in
// utils/stock.js (applyStockMovement), because POST /api/returns became a third caller and a
// third hand-written copy of the same logic was not worth having. Behaviour here is unchanged —
// it's the identical code, moved.

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
  // product.costPrice rides along so a STOCK_IN can snapshot it below — this is an internal
  // read for that purpose only, never forwarded to the response (see TRANSACTION_RESPONSE_SELECT).
  const bundle = await prisma.bundle.findUnique({
    where: { id: bundleId },
    select: { id: true, product: { select: { costPrice: true } } },
  });
  if (!bundle) {
    return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${bundleId}`);
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${locationId}`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Find-or-create plus the guarded write, in one shared call — see utils/stock.js. Throws
      // with isInsufficientStock set when a STOCK_OUT would go negative, caught below.
      const stock = await applyStockMovement(tx, { bundleId, locationId, type, qtySets });

      // Re-read inside the same transaction so the response reflects the true post-write
      // values, not a value computed in JS from a possibly-stale earlier read.
      const updatedStock = await tx.stock.findUnique({ where: { id: stock.id } });

      // Populated only for STOCK_IN, and only from the Product's costPrice AT THIS EXACT
      // MOMENT — a later price change must never retroactively alter what this specific
      // receipt owed the factory (verified directly in the payable calculation's own test).
      // Null costPrice (still pending) snapshots as null, not 0 — genuinely "unknown at the
      // time," which the payable sum treats as contributing nothing, correctly.
      const costPriceSnapshot = type === 'STOCK_IN' ? bundle.product.costPrice : null;

      const transaction = await tx.transaction.create({
        data: { stockId: stock.id, userId: req.user.id, type, qtySets, note: note || null, costPriceSnapshot },
        select: TRANSACTION_RESPONSE_SELECT,
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
