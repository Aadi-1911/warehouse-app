const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { applyStockMovement } = require('../utils/stock');

const prisma = new PrismaClient();

const VALID_REASONS = ['WRONG_QUANTITY', 'WRONG_LOCATION', 'WRONG_FACTORY', 'WRONG_PRICE', 'OTHER'];

// POST /api/transaction-corrections — OWNER only (👑), unconditionally — matches rule 70's
// reversal (see routes/transactionCorrections.js and 05_BUSINESS_RULES.md's own updated rule 70
// for why this landed on the owner surface, not staff's). PIN is conditional: only required when
// the request actually changes costPriceSnapshot (req.body.costPrice present) — the same
// "role is unconditional, PIN is conditional on price" split routes/products.js already uses for
// requirePinForPriceEdits, applied here for the identical reason (rule 71: the moment a real
// price appears in the request, OWNER+PIN applies without exception — a correction that touches
// cost price is still a cost-price edit, even though it's Transaction.costPriceSnapshot rather
// than Product.costPrice).
//
// Only STOCK_IN (Receive Stock receipts) can be corrected here. Transfer corrections are a
// deliberately separate, deferred follow-up task — this endpoint rejects anything else.
async function createTransactionCorrection(req, res) {
  const { transactionId, bundleId, locationId, qtySets, reason, note } = req.body;
  const correctingPrice = 'costPrice' in req.body;
  const costPrice = correctingPrice ? req.body.costPrice : undefined;

  if (!transactionId || !bundleId || !locationId || qtySets == null || !reason) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'transactionId, bundleId, locationId, qtySets, and reason are required'
    );
  }
  if (!VALID_REASONS.includes(reason)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `reason must be one of: ${VALID_REASONS.join(', ')}`);
  }
  // Same "OTHER makes note mandatory" rule GoodReturnReason already established — enforced at the
  // app layer, same as there, since the schema can't express a conditional-required field.
  if (reason === 'OTHER' && !note) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'note is required when reason is OTHER');
  }
  if (!Number.isInteger(qtySets) || qtySets <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'qtySets must be a positive integer');
  }
  if (correctingPrice && (typeof costPrice !== 'number' || costPrice < 0)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'costPrice must be a non-negative number');
  }

  const original = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      type: true,
      qtySets: true,
      costPriceSnapshot: true,
      stock: { select: { bundleId: true, locationId: true } },
      correctionAsOriginal: { select: { id: true } },
    },
  });
  if (!original) {
    return sendError(res, 404, 'TRANSACTION_NOT_FOUND', `No transaction with id ${transactionId}`);
  }
  if (original.type !== 'STOCK_IN') {
    return sendError(res, 400, 'NOT_A_RECEIPT', 'Only Receive Stock (STOCK_IN) entries can be corrected here');
  }
  if (original.correctionAsOriginal) {
    return sendError(
      res,
      409,
      'ALREADY_CORRECTED',
      'This receipt has already been corrected — correct the replacement entry instead, not the original again'
    );
  }

  const bundle = await prisma.bundle.findUnique({ where: { id: bundleId } });
  if (!bundle) {
    return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${bundleId}`);
  }
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${locationId}`);
  }

  // What the replacement's costPriceSnapshot should be: the explicitly-corrected value when this
  // correction is actually about price, otherwise the ORIGINAL's own snapshot carried forward
  // unchanged — the receipt still happened at the same real moment, just with one detail
  // mis-recorded, so a quantity/location/article fix must not silently re-price it against
  // whatever the Product's live costPrice happens to be today.
  const newCostPriceSnapshot = correctingPrice ? costPrice : original.costPriceSnapshot;

  const nothingChanged =
    bundleId === original.stock.bundleId &&
    locationId === original.stock.locationId &&
    qtySets === original.qtySets &&
    (newCostPriceSnapshot == null
      ? original.costPriceSnapshot == null
      : Number(newCostPriceSnapshot) === Number(original.costPriceSnapshot));
  if (nothingChanged) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Nothing to correct — the corrected values match the original');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Reverse the original's exact stock effect. Throws isInsufficientStock if some of that
      // wrongly-received stock has already left the building (sold, transferred, returned) — you
      // cannot un-receive stock that's no longer on hand, and that's the correct outcome here,
      // not a bug to work around.
      await applyStockMovement(tx, {
        bundleId: original.stock.bundleId,
        locationId: original.stock.locationId,
        type: 'STOCK_OUT',
        qtySets: original.qtySets,
      });
      const reversalStock = await tx.stock.findUnique({
        where: { bundleId_locationId: { bundleId: original.stock.bundleId, locationId: original.stock.locationId } },
      });
      await tx.transaction.create({
        data: {
          stockId: reversalStock.id,
          userId: req.user.id,
          type: 'STOCK_OUT',
          qtySets: original.qtySets,
          note: 'Correction reversal',
        },
      });

      // 2. Apply the corrected effect.
      const replacementStock = await applyStockMovement(tx, { bundleId, locationId, type: 'STOCK_IN', qtySets });
      const replacement = await tx.transaction.create({
        data: {
          stockId: replacementStock.id,
          userId: req.user.id,
          type: 'STOCK_IN',
          qtySets,
          costPriceSnapshot: newCostPriceSnapshot,
        },
      });

      // 3. Link original -> replacement. originalId's unique constraint is the last line of
      // defence against two concurrent corrections of the same receipt racing each other.
      const correction = await tx.transactionCorrection.create({
        data: {
          originalId: transactionId,
          replacementId: replacement.id,
          reason,
          note: note || null,
          correctedById: req.user.id,
        },
        select: { id: true, originalId: true, replacementId: true, reason: true, note: true, createdAt: true },
      });

      return correction;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 400, 'INSUFFICIENT_STOCK', err.message);
    }
    if (err.code === 'P2002' && err.meta?.target?.includes('originalId')) {
      return sendError(res, 409, 'ALREADY_CORRECTED', 'This receipt has already been corrected');
    }
    throw err;
  }
}

module.exports = { createTransactionCorrection };
