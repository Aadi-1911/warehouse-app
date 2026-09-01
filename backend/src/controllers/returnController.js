const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
const { applyStockMovement } = require('../utils/stock');

const prisma = new PrismaClient();

// Good Returns — whole sets coming back from a Party, logged after the fact (05_BUSINESS_RULES.md
// rule 86). A simple event log, not a pending/settled workflow: no lifecycle, no approval state,
// no partial settlement. Each logged line puts real stock back on a shelf and records what it was
// worth, and that is the whole feature.
//
// Deliberately NOT touching Party.runningDueBalance (rule 86) — reconciling a return against what
// a Party owes is a manual decision the owner makes, not an automatic ledger entry. That's a
// business rule, not an omission.

// Mirrors the GoodReturnReason enum in schema.prisma exactly. Kept as a plain array rather than
// imported from Prisma's generated enums so a bad `reason` produces a clean 400 with the valid
// values listed, instead of a raw Prisma error surfacing as a 500.
const VALID_REASONS = [
  'NOT_ORDERED',
  'SIZE_ISSUE',
  'COLOUR_NOT_ORDERED',
  'COLOUR_BLEEDING',
  'ACCESSORIES_ISSUE',
  'OTHER',
];

// The reason value that makes `note` mandatory. The schema can't express a conditional
// requirement (03_DATABASE_SCHEMA.md §1.1), so this is the enforcement point — an "Other" with no
// explanation records literally nothing about why goods came back.
const REASON_REQUIRING_NOTE = 'OTHER';

// priceAtReturn IS included — it's a selling price, and this whole feature is party-facing
// (rule 10 only ever restricts costPrice, which appears nowhere in this file at all, at any role).
const RETURN_SELECT = {
  id: true,
  partyId: true,
  party: { select: { name: true } },
  partyNameSnapshot: true,
  bundleId: true,
  bundle: {
    select: {
      product: { select: { id: true, articleNo: true, name: true } },
      color: { select: { id: true, name: true } },
    },
  },
  locationId: true,
  location: { select: { name: true } },
  qtySets: true,
  priceAtReturn: true,
  productNameSnapshot: true,
  reason: true,
  note: true,
  createdAt: true,
  userId: true,
  user: { select: { name: true } },
};

function toResponse(r) {
  return {
    id: r.id,
    partyId: r.partyId,
    // Snapshot first, live name only as the pre-2026-09-02 fallback — see
    // PartyStockReturn.partyNameSnapshot's schema comment for the full reasoning.
    partyName: r.partyNameSnapshot ?? r.party.name,
    bundleId: r.bundleId,
    productId: r.bundle.product.id,
    productArticleNo: r.bundle.product.articleNo,
    // Snapshot first, live name only as the pre-2026-08-28 fallback — see
    // OrderLineItem.productNameSnapshot's schema comment for the full reasoning.
    productName: r.productNameSnapshot ?? r.bundle.product.name,
    colorId: r.bundle.color.id,
    colorName: r.bundle.color.name,
    locationId: r.locationId,
    locationName: r.location.name,
    qtySets: r.qtySets,
    priceAtReturn: r.priceAtReturn,
    reason: r.reason,
    note: r.note,
    createdAt: r.createdAt,
    userId: r.userId,
    userName: r.user.name,
  };
}

// POST /api/returns — any authenticated role (🔒). Staff receive returned goods at the counter;
// this is a staff-primary flow, not an owner action, same reasoning as POST /api/orders.
//
// Body: { partyId, locationId, lines: [{ bundleId, qtySets, reason, note? }] }
//
// Everything is validated and resolved BEFORE the database is touched at all — that's what makes
// "one bad line ⇒ nothing created" true by construction, rather than by relying on a rollback
// after a partial write was already attempted. Same shape as createOrder.
async function createReturns(req, res) {
  const { partyId, locationId, lines } = req.body;

  if (!partyId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'partyId is required');
  }
  if (!locationId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'locationId is required');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'lines must be a non-empty array');
  }

  for (const line of lines) {
    if (!line || !line.bundleId) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line requires a bundleId');
    }
    // Whole sets only, never partial pieces (rule 86) — a non-integer here isn't a rounding
    // question, it's a line that shouldn't exist.
    if (!Number.isInteger(line.qtySets) || line.qtySets <= 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line requires a positive integer qtySets');
    }
    if (!line.reason) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each line requires a reason');
    }
    if (!VALID_REASONS.includes(line.reason)) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `reason must be one of: ${VALID_REASONS.join(', ')}`
      );
    }
    // The conditional requirement the schema can't hold. Trimmed before testing, so a note of
    // pure whitespace is treated as the absence it actually is rather than passing on length.
    if (line.reason === REASON_REQUIRING_NOTE && !String(line.note ?? '').trim()) {
      return sendError(
        res,
        400,
        'NOTE_REQUIRED',
        'A note is required when the reason is Other — it is the only record of why these goods came back'
      );
    }
  }

  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) {
    return sendError(res, 404, 'PARTY_NOT_FOUND', `No party with id ${partyId}`);
  }
  // Same gate as placing an order: an archived Party is hidden from daily pickers (rule 85), so a
  // new return being logged against one means something is wrong upstream, not that we should
  // quietly accept it.
  if (!party.isActive) {
    return sendError(
      res,
      409,
      'PARTY_ARCHIVED',
      `Party "${party.name}" is archived and cannot have returns logged against it`
    );
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${locationId}`);
  }

  // One batch fetch for every bundle referenced rather than one query per line — same
  // resolve-everything-then-validate shape as createOrder, and no N+1 on a multi-line return.
  const bundleIds = [...new Set(lines.map((l) => l.bundleId))];
  const bundles = await prisma.bundle.findMany({
    where: { id: { in: bundleIds } },
    select: { id: true, product: { select: { sellingPrice: true, name: true } } },
  });
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  // priceAtReturn is computed HERE, server-side, from Product.sellingPrice at this exact moment —
  // never trusted from the request body, and never sourced from costPrice (rule 10). Same
  // principle as OrderLineItem.priceAtOrder and Transaction.costPriceSnapshot.
  // productNameSnapshot (2026-08-28) is captured from the same read, at the same instant, so a
  // later article rename can never rewrite what a logged return says it was for.
  const resolvedLines = [];
  for (const line of lines) {
    const bundle = bundleById.get(line.bundleId);
    if (!bundle) {
      return sendError(res, 404, 'BUNDLE_NOT_FOUND', `No bundle with id ${line.bundleId}`);
    }
    if (bundle.product.sellingPrice == null) {
      return sendError(
        res,
        400,
        'UNPRICED_PRODUCT',
        `The article for bundle ${line.bundleId} has no selling price set yet, so this return cannot be valued`
      );
    }
    resolvedLines.push({
      bundleId: line.bundleId,
      qtySets: line.qtySets,
      reason: line.reason,
      // Normalised to null rather than '' so "no note" is one value in the database, not two.
      note: String(line.note ?? '').trim() || null,
      priceAtReturn: bundle.product.sellingPrice,
      productNameSnapshot: bundle.product.name,
    });
  }

  // One transaction for every line: all the stock increases, all the PartyStockReturn rows, and
  // all the Transaction rows either land together or not at all.
  const created = await prisma.$transaction(async (tx) => {
    const ids = [];

    for (const line of resolvedLines) {
      // Reuses the same shared movement helper POST /api/transactions uses — including the
      // find-or-create, which matters here: returned goods can legitimately be put back at a
      // location that has never held this bundle before, and that pairing has no Stock row yet.
      const stock = await applyStockMovement(tx, {
        bundleId: line.bundleId,
        locationId,
        type: 'STOCK_IN',
        qtySets: line.qtySets,
      });

      const partyStockReturn = await tx.partyStockReturn.create({
        data: {
          partyId,
          bundleId: line.bundleId,
          locationId,
          qtySets: line.qtySets,
          priceAtReturn: line.priceAtReturn,
          reason: line.reason,
          note: line.note,
          userId: req.user.id,
          productNameSnapshot: line.productNameSnapshot,
          // Captured from the same `party` read already used for the isActive check above, at
          // this exact instant — never from the request body, same principle as
          // line.productNameSnapshot immediately above.
          partyNameSnapshot: party.name,
        },
      });

      await tx.transaction.create({
        data: {
          stockId: stock.id,
          userId: req.user.id,
          type: 'STOCK_IN',
          qtySets: line.qtySets,
          note: line.note,
          partyId,
          // Links the stock movement back to the return that caused it — the same relationship
          // Transfer already has with its two legs (Transaction.transferId).
          partyStockReturnId: partyStockReturn.id,
          // NULL DELIBERATELY, and this is the subtle one. costPriceSnapshot records what was
          // owed to a FACTORY for a receipt, and GET /api/factories/:id/payable sums exactly
          // these STOCK_IN rows to compute that debt. Goods coming back from a customer create
          // no factory debt whatsoever — snapshotting a cost here would inflate the payable
          // figure with money that was never owed. Null contributes zero to that sum, which is
          // the correct contribution. Same reasoning transferController applies to its own legs.
          costPriceSnapshot: null,
        },
      });

      ids.push(partyStockReturn.id);
    }

    // Re-read inside the transaction with the display-ready select, so the response reflects true
    // post-write state rather than being reassembled in JS from the inputs.
    return tx.partyStockReturn.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: RETURN_SELECT,
    });
  });

  res.status(201).json(created.map(toResponse));
}

// GET /api/returns — any authenticated role (🔒). Newest first. No filters yet, deliberately:
// nothing in the app needs one, and the honest version of "no filtering required" is not building
// a query vocabulary nobody calls.
async function listReturns(req, res) {
  const returns = await prisma.partyStockReturn.findMany({
    orderBy: { createdAt: 'desc' },
    select: RETURN_SELECT,
  });

  res.json(returns.map(toResponse));
}

module.exports = { createReturns, listReturns, VALID_REASONS };
