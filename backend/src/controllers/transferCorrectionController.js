const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { applyStockMovement } = require('../utils/stock');

const prisma = new PrismaClient();

const VALID_REASONS = ['WRONG_QUANTITY', 'WRONG_FROM_LOCATION', 'WRONG_TO_LOCATION', 'OTHER'];

// POST /api/transfer-corrections — OWNER only (👑), no PIN, ever. Unlike Transaction Corrections
// (receipts), a Transfer never touches price — costPriceSnapshot is null on both legs by design
// (an internal move between our own locations creates no debt to anyone) — so there is no
// conditional PIN branch here at all, unlike routes/transactionCorrections.js.
//
// Bundle/article is not correctable here — the task scoped this to quantity/from-location/
// to-location only, matching what a Transfer itself can actually get wrong (it has no Factory
// concept and no price, so WRONG_FACTORY/WRONG_PRICE from TransactionCorrectionReason don't apply
// — this uses its own TransferCorrectionReason instead).
async function createTransferCorrection(req, res) {
  const { transferId, fromLocationId, toLocationId, qtySets, reason, note } = req.body;

  if (!transferId || !fromLocationId || !toLocationId || qtySets == null || !reason) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'transferId, fromLocationId, toLocationId, qtySets, and reason are required'
    );
  }
  if (!VALID_REASONS.includes(reason)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `reason must be one of: ${VALID_REASONS.join(', ')}`);
  }
  if (reason === 'OTHER' && !note) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'note is required when reason is OTHER');
  }
  if (!Number.isInteger(qtySets) || qtySets <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'qtySets must be a positive integer');
  }
  // Same rule the original createTransfer enforces — a "transfer" to the same location isn't one.
  if (fromLocationId === toLocationId) {
    return sendError(
      res,
      400,
      'SAME_LOCATION',
      'fromLocationId and toLocationId must be different — a transfer must move stock between two different locations'
    );
  }

  const original = await prisma.transfer.findUnique({
    where: { id: transferId },
    select: {
      id: true,
      bundleId: true,
      fromLocationId: true,
      toLocationId: true,
      qtySets: true,
      correctionAsOriginal: { select: { id: true } },
    },
  });
  if (!original) {
    return sendError(res, 404, 'TRANSFER_NOT_FOUND', `No transfer with id ${transferId}`);
  }
  if (original.correctionAsOriginal) {
    return sendError(
      res,
      409,
      'ALREADY_CORRECTED',
      'This transfer has already been corrected — correct the replacement entry instead, not the original again'
    );
  }

  const [fromLocation, toLocation] = await Promise.all([
    prisma.location.findUnique({ where: { id: fromLocationId } }),
    prisma.location.findUnique({ where: { id: toLocationId } }),
  ]);
  if (!fromLocation) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${fromLocationId}`);
  }
  if (!toLocation) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${toLocationId}`);
  }

  const nothingChanged =
    fromLocationId === original.fromLocationId &&
    toLocationId === original.toLocationId &&
    qtySets === original.qtySets;
  if (nothingChanged) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Nothing to correct — the corrected values match the original');
  }

  // Shared by both the reversal and the replacement below — a Transfer's own two-leg creation,
  // reusing applyStockMovement per leg exactly as POST /api/transfers does, never a direct Stock
  // write. Kept local to this controller (not extracted into transferController.js) since this is
  // the only other caller and the task's own instruction was to reuse applyStockMovement, not to
  // refactor the sibling endpoint.
  async function createTransferLegs(tx, { bundleId, fromLocationId, toLocationId, qtySets, note }) {
    const fromStock = await applyStockMovement(tx, { bundleId, locationId: fromLocationId, type: 'STOCK_OUT', qtySets });
    const toStock = await applyStockMovement(tx, { bundleId, locationId: toLocationId, type: 'STOCK_IN', qtySets });

    const transfer = await tx.transfer.create({
      data: { bundleId, fromLocationId, toLocationId, qtySets, userId: req.user.id, note: note || null },
    });
    await tx.transaction.createMany({
      data: [
        { stockId: fromStock.id, userId: req.user.id, type: 'TRANSFER_OUT', qtySets, transferId: transfer.id, note: note || null },
        { stockId: toStock.id, userId: req.user.id, type: 'TRANSFER_IN', qtySets, transferId: transfer.id, note: note || null },
      ],
    });
    return transfer;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Reversal — a Transfer back the way the original came, undoing its exact stock effect.
      // Its own fromLocation (the STOCK_OUT leg) is the original's DESTINATION, which is where
      // INSUFFICIENT_STOCK can surface: some of what arrived there may have already left via a
      // sale, another transfer, or a return elsewhere, and that stock can't be un-transferred.
      const reversal = await createTransferLegs(tx, {
        bundleId: original.bundleId,
        fromLocationId: original.toLocationId,
        toLocationId: original.fromLocationId,
        qtySets: original.qtySets,
        note: 'Correction reversal',
      });

      // 2. Replacement — applies exactly the way a brand-new Transfer would, at the corrected
      // values. Independently INSUFFICIENT_STOCK-able at the corrected source.
      const replacement = await createTransferLegs(tx, {
        bundleId: original.bundleId,
        fromLocationId,
        toLocationId,
        qtySets,
      });

      // 3. Link original -> reversal -> replacement. originalTransferId's unique constraint is the
      // last line of defence against two concurrent corrections of the same transfer racing.
      const correction = await tx.transferCorrection.create({
        data: {
          originalTransferId: transferId,
          reversalTransferId: reversal.id,
          replacementTransferId: replacement.id,
          reason,
          note: note || null,
          correctedById: req.user.id,
        },
        select: { id: true, originalTransferId: true, replacementTransferId: true, reason: true, note: true, createdAt: true },
      });

      return correction;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 400, 'INSUFFICIENT_STOCK', err.message);
    }
    if (err.code === 'P2002' && err.meta?.target?.includes('originalTransferId')) {
      return sendError(res, 409, 'ALREADY_CORRECTED', 'This transfer has already been corrected');
    }
    throw err;
  }
}

module.exports = { createTransferCorrection };
