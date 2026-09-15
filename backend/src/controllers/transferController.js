const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// The joined shape both endpoints return — same "display-ready, IDs alongside names" design as
// listTransactions (see its own comment): a client rendering a transfer log shouldn't need a
// second round trip to turn bundleId/locationId into something a human can read.
const TRANSFER_SELECT = {
  id: true,
  bundleId: true,
  qtySets: true,
  note: true,
  productNameSnapshot: true,
  createdAt: true,
  userId: true,
  user: { select: { name: true } },
  bundle: {
    select: {
      product: { select: { id: true, articleNo: true, name: true } },
      color: { select: { id: true, name: true } },
    },
  },
  fromLocationId: true,
  fromLocation: { select: { name: true } },
  toLocationId: true,
  toLocation: { select: { name: true } },
};

function toResponse(t) {
  return {
    id: t.id,
    bundleId: t.bundleId,
    productId: t.bundle.product.id,
    productArticleNo: t.bundle.product.articleNo,
    // Snapshot first, live name only as the pre-2026-08-28 fallback — see
    // OrderLineItem.productNameSnapshot's schema comment for the full reasoning.
    productName: t.productNameSnapshot ?? t.bundle.product.name,
    colorId: t.bundle.color.id,
    colorName: t.bundle.color.name,
    fromLocationId: t.fromLocationId,
    fromLocationName: t.fromLocation.name,
    toLocationId: t.toLocationId,
    toLocationName: t.toLocation.name,
    qtySets: t.qtySets,
    note: t.note,
    createdAt: t.createdAt,
    userId: t.userId,
    userName: t.user.name,
  };
}

// Builds the response for a request whose idempotencyKey has already been used — i.e. this exact
// line was already applied, and this call is a retry of a request whose response was lost rather
// than a new instruction.
//
// Stock figures are read LIVE, not reconstructed as they stood at the moment of the original
// write. That is deliberate and is the honest answer to "what is true now": other transfers may
// legitimately have moved the same bundle since. Replaying the original post-write numbers would
// hand the caller a figure that was correct once and may not be any more, which is worse than
// useless on a screen whose whole job is showing what's actually where.
async function buildReplayResponse(existing) {
  const [fromStock, toStock] = await Promise.all([
    prisma.stock.findUnique({
      where: { bundleId_locationId: { bundleId: existing.bundleId, locationId: existing.fromLocationId } },
    }),
    prisma.stock.findUnique({
      where: { bundleId_locationId: { bundleId: existing.bundleId, locationId: existing.toLocationId } },
    }),
  ]);

  return {
    transfer: toResponse(existing),
    fromStock: { locationId: existing.fromLocationId, qtySets: fromStock?.qtySets ?? 0 },
    toStock: { locationId: existing.toLocationId, qtySets: toStock?.qtySets ?? 0 },
    // Explicit rather than inferred from the status code, so a caller (or a log line, or a test)
    // can tell a replay from a fresh create without having to know that 200-vs-201 carries that
    // meaning here.
    idempotentReplay: true,
  };
}

// POST /api/transfers — any authenticated role (🔒).
//
// This is the ONLY way a TRANSFER_OUT/TRANSFER_IN Transaction is ever created. POST
// /api/transactions deliberately still rejects both types (see VALID_TYPES in
// transactionController.js): letting a caller post a lone TRANSFER_OUT there would let stock
// leave one location without ever arriving at the other, breaking the exact invariant this
// endpoint exists to guarantee. The pairing is the point, so the pair only has one door.
//
// Everything below happens inside a single prisma.$transaction: the Transfer row, the source
// decrement, the destination increment, and both Transaction rows either all land or none do.
// A crash or network failure mid-way can never leave stock "in transit" between two locations.
//
// === IDEMPOTENCY (added 2026-09-11, rule 107) ===
//
// Atomicity above guarantees a request is applied fully or not at all. It says nothing about a
// request being applied TWICE, which is a different failure with a different cause: the commit
// succeeds, the response is lost on the way back (a dropped connection, a gateway timeout, a
// backgrounded PWA), the client records the line as failed, and the person presses "try again".
// The retry is byte-identical to the original, so without a key the server has no way to tell it
// from a genuine second transfer of the same bundle/route/quantity — and applies it again.
//
// The 2026-09-10 audit found no evidence this had actually happened across all 47 Production
// transfer rows, at any key-width or time window tested. That was never a guarantee, though: it
// was an absence of evidence in a small single-session sample, and the code had nothing in it
// that would have prevented the double-apply. This closes that gap.
//
// The key is OPTIONAL at the API level, not required, and that is a deployment-ordering decision
// rather than laxity. Backend and frontend do not deploy atomically: for a window after the
// backend ships, a person with the app already open is still running the previous JS bundle,
// which sends no key. Hard-rejecting those requests would break transfers mid-session for
// exactly the people already using the screen. Requests without a key behave exactly as they did
// before — no protection, but no regression either. Once every client is known to send one, this
// can be tightened to required in its own separate change.
async function createTransfer(req, res) {
  const { bundleId, fromLocationId, toLocationId, qtySets, note, idempotencyKey } = req.body;

  // Validated for SHAPE only, never for content: the server never generates, parses or interprets
  // this value, it only compares it for equality. Requiring a specific format (a UUID, say) would
  // couple the server to one client's choice of generator for no gain. The length ceiling exists
  // so a malformed or hostile client can't push an unbounded string into a unique index.
  if (idempotencyKey !== undefined && idempotencyKey !== null) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '' || idempotencyKey.length > 200) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'idempotencyKey must be a non-empty string of at most 200 characters'
      );
    }
  }

  if (!bundleId || !fromLocationId || !toLocationId) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'bundleId, fromLocationId, and toLocationId are required'
    );
  }
  // Enforced here because the schema can't express it (see the Transfer model's own comment) —
  // a "transfer" to the same location isn't a transfer, it's a data-entry mistake that would
  // otherwise write two cancelling Transaction rows and a Transfer record documenting nothing.
  if (fromLocationId === toLocationId) {
    return sendError(
      res,
      400,
      'SAME_LOCATION',
      'fromLocationId and toLocationId must be different — a transfer must move stock between two different locations'
    );
  }
  if (!Number.isInteger(qtySets) || qtySets <= 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'qtySets must be a positive integer');
  }

  // Pre-flight replay check. Deliberately BEFORE the bundle/location lookups and before the
  // transaction: a key that has already been used describes work that is already done, so none of
  // the validation below is relevant to it. Checking here also means a retry stays cheap — one
  // indexed lookup instead of the full write path.
  //
  // This check ALONE is not sufficient, and is not treated as if it were. Two concurrent requests
  // carrying the same key can both run this lookup before either has inserted, both miss, and
  // both proceed. The unique index on Transfer.idempotencyKey is what actually makes that
  // impossible; the catch below converts the loser's constraint violation into the same replay
  // response this path returns. Pre-flight is the fast path, the constraint is the correct one.
  if (idempotencyKey) {
    const existing = await prisma.transfer.findUnique({
      where: { idempotencyKey },
      select: TRANSFER_SELECT,
    });
    if (existing) {
      // 200, not 201: nothing was created by this request. The distinction matters for anything
      // reading status codes as "did this write" — a monitor, a log, a future client.
      return res.status(200).json(await buildReplayResponse(existing));
    }
  }

  // product.name is selected here purely to snapshot it onto the Transfer below (2026-08-28) —
  // read at this exact moment, server-side, never taken from the request body, same principle
  // every other snapshot on this project follows.
  const bundle = await prisma.bundle.findUnique({
    where: { id: bundleId },
    include: { product: { select: { name: true } } },
  });
  if (!bundle) {
    return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${bundleId}`);
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

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Source: upsert-then-guarded-decrement, the identical pattern STOCK_OUT uses. The upsert
      // looks odd for a source (you can't move stock from a location that has no Stock row) —
      // but creating it at qtySets: 0 and letting the guard below reject the decrement produces
      // exactly the right INSUFFICIENT_STOCK answer, rather than a separate "no stock row" error
      // path saying the same thing in different words.
      const fromStock = await tx.stock.upsert({
        where: { bundleId_locationId: { bundleId, locationId: fromLocationId } },
        update: {},
        create: { bundleId, locationId: fromLocationId, qtySets: 0 },
      });

      // The guard IS the check — `qtySets: { gte: qtySets }` in the WHERE clause means the
      // decrement and the "is there enough?" test are one atomic statement, so two concurrent
      // transfers of the same bundle can't both pass a separate read-then-write check and drive
      // stock negative. updateResult.count === 0 means the guard didn't match, i.e. not enough.
      const decremented = await tx.stock.updateMany({
        where: { id: fromStock.id, qtySets: { gte: qtySets } },
        data: { qtySets: { decrement: qtySets } },
      });

      if (decremented.count === 0) {
        const err = new Error(
          `This transfer would take qtySets negative at the source location (available: ${fromStock.qtySets}, requested: ${qtySets})`
        );
        err.isInsufficientStock = true;
        throw err;
      }

      // Destination: a bundle that has never been held at this location legitimately has no
      // Stock row yet — this upsert is what creates it, exactly as STOCK_IN's does.
      const toStock = await tx.stock.upsert({
        where: { bundleId_locationId: { bundleId, locationId: toLocationId } },
        update: {},
        create: { bundleId, locationId: toLocationId, qtySets: 0 },
      });
      await tx.stock.update({
        where: { id: toStock.id },
        data: { qtySets: { increment: qtySets } },
      });

      const transfer = await tx.transfer.create({
        data: {
          bundleId,
          fromLocationId,
          toLocationId,
          qtySets,
          userId: req.user.id,
          note: note || null,
          productNameSnapshot: bundle.product.name,
          // Written INSIDE the same transaction as the stock movement it protects. That coupling
          // is the point: the key and the effect it guards commit together or roll back together,
          // so there is no window where the stock moved but the key wasn't recorded (which would
          // leave the retry unprotected) or the key was recorded but the stock didn't move (which
          // would suppress a legitimate retry).
          idempotencyKey: idempotencyKey || null,
        },
      });

      // Both legs carry costPriceSnapshot: null (the schema default) — deliberately, not an
      // oversight. That field records what was owed to a factory for a receipt; an internal
      // transfer between our own locations creates no such debt and changes total company-wide
      // stock by exactly zero, so snapshotting a cost here would inflate the payable figure
      // with money that was never owed a second time.
      await tx.transaction.createMany({
        data: [
          { stockId: fromStock.id, userId: req.user.id, type: 'TRANSFER_OUT', qtySets, transferId: transfer.id, note: note || null },
          { stockId: toStock.id, userId: req.user.id, type: 'TRANSFER_IN', qtySets, transferId: transfer.id, note: note || null },
        ],
      });

      // Re-read both inside the transaction so the response reports true post-write values,
      // never a number computed in JS from a possibly-stale earlier read.
      const [updatedFromStock, updatedToStock, created] = await Promise.all([
        tx.stock.findUnique({ where: { id: fromStock.id } }),
        tx.stock.findUnique({ where: { id: toStock.id } }),
        tx.transfer.findUnique({ where: { id: transfer.id }, select: TRANSFER_SELECT }),
      ]);

      return {
        transfer: toResponse(created),
        fromStock: { locationId: fromLocationId, qtySets: updatedFromStock.qtySets },
        toStock: { locationId: toLocationId, qtySets: updatedToStock.qtySets },
      };
    });

    res.status(201).json({ ...result, idempotentReplay: false });
  } catch (err) {
    if (err.isInsufficientStock) {
      return sendError(res, 400, 'INSUFFICIENT_STOCK', err.message);
    }

    // The concurrency case the pre-flight check structurally cannot catch: another request
    // carrying this same key inserted between our lookup and our insert. P2002 is Prisma's
    // unique-constraint violation, and the whole transaction has already rolled back by the time
    // it surfaces — so no stock moved on this attempt, and the winner's write is intact.
    //
    // Re-reading rather than reporting the conflict is the correct response: from the caller's
    // side this is the same situation the pre-flight path handles (this line is already applied),
    // it just lost a race to discover it. Surfacing a 409 here would tell a client that its line
    // failed when the line in fact succeeded, which is precisely the false-failure this whole
    // mechanism exists to eliminate.
    //
    // The target check keeps this narrow: any OTHER unique violation is a real bug and must keep
    // propagating rather than being quietly reinterpreted as a successful transfer.
    const target = JSON.stringify(err?.meta?.target ?? '');
    if (idempotencyKey && err?.code === 'P2002' && target.includes('idempotencyKey')) {
      const existing = await prisma.transfer.findUnique({
        where: { idempotencyKey },
        select: TRANSFER_SELECT,
      });
      if (existing) {
        return res.status(200).json(await buildReplayResponse(existing));
      }
    }

    throw err;
  }
}

// GET /api/transfers — any authenticated role (🔒). Audit/history view, newest first, same
// filter vocabulary as GET /api/transactions.
async function listTransfers(req, res) {
  const { bundleId, fromLocationId, toLocationId, userId, from, to } = req.query;

  const where = {};
  if (bundleId) where.bundleId = bundleId;
  if (fromLocationId) where.fromLocationId = fromLocationId;
  if (toLocationId) where.toLocationId = toLocationId;
  if (userId) where.userId = userId;
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

  const transfers = await prisma.transfer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: TRANSFER_SELECT,
  });

  res.json(transfers.map(toResponse));
}

module.exports = { createTransfer, listTransfers };
