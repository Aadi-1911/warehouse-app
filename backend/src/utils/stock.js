// The single implementation of "change a Stock quantity," shared by every endpoint that moves
// inventory. Extracted from transactionController (2026-08-18) when Good Returns became the
// third caller — previously transactionController owned this and transferController had already
// written its own second copy inline.
//
// Why this is shared rather than re-typed per controller: the upsert below is the non-obvious
// part. A bundle/location pairing with no prior activity has NO Stock row at all, so a bare
// `stock.update` throws instead of creating one. Any hand-rolled "just increment it" version
// gets that wrong the first time stock arrives at a new location, which is exactly the kind of
// bug that only shows up in production data.

// Maps a transaction type to (a) the Prisma update it applies and (b) the WHERE-clause guard
// that must hold for the update to be allowed to run at all. The guard is what makes the
// negative-quantity check atomic with the write itself — see LEARNING_LOG.md for why a separate
// read-then-check-then-write would be race-prone here.
//
// STOCK_IN's guard is deliberately empty: an increase can never drive a quantity negative, so
// there is nothing to guard against. That asymmetry is the point of returning the guard from
// here rather than making every caller remember which direction needs one.
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
    default:
      throw new Error(`Unhandled transaction type: ${type}`);
  }
}

// Applies one stock movement inside an existing Prisma transaction (`tx`), and returns the Stock
// row it acted on — the PRE-update row, so callers that need true post-write numbers re-read it
// inside the same transaction rather than computing them in JS from a possibly-stale value.
//
// Takes `tx`, never the top-level client: every caller here is part of a larger all-or-nothing
// operation (a Transaction row, a Transfer's paired legs, a multi-line return), and a stock
// change that couldn't roll back with the rest of its operation would be the exact failure mode
// those transactions exist to prevent.
//
// Throws an error flagged `isInsufficientStock` when the guard rejects the write, letting each
// caller map it to its own INSUFFICIENT_STOCK message with whatever context makes sense there.
async function applyStockMovement(tx, { bundleId, locationId, type, qtySets }) {
  // Find-or-create. `update: {}` never touches quantities on an existing row — only the create
  // branch sets one, at zero, leaving the real change to the guarded update below.
  const stock = await tx.stock.upsert({
    where: { bundleId_locationId: { bundleId, locationId } },
    update: {},
    create: { bundleId, locationId, qtySets: 0 },
  });

  const { data, guard, insufficientField } = buildStockUpdate(type, qtySets);

  // updateMany (not update) because only updateMany accepts extra WHERE conditions beyond the
  // id — which is what lets the guard and the write be one statement. count === 0 means the
  // guard didn't match, i.e. there wasn't enough stock.
  const updateResult = await tx.stock.updateMany({ where: { id: stock.id, ...guard }, data });

  if (updateResult.count === 0) {
    const err = new Error(
      `This ${type} would take ${insufficientField} negative for this bundle/location`
    );
    err.isInsufficientStock = true;
    throw err;
  }

  return stock;
}

module.exports = { buildStockUpdate, applyStockMovement };
