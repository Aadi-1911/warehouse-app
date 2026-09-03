const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');
// Moved to utils/piecesPerSet.js (2026-08-19) when the Owner Dashboard became a second caller —
// same code, one home. Re-exported below so any existing importer of this controller is unaffected.
const { piecesPerSetFor } = require('../utils/piecesPerSet');

const prisma = new PrismaClient();

const SELECT = { id: true, name: true, contact: true, gstNo: true, isActive: true };

// GET /api/factories — any authenticated role (🔒)
async function listFactories(req, res) {
  const factories = await prisma.factory.findMany({ select: SELECT });
  res.json(factories);
}

// POST /api/factories — any authenticated role (🔒) — Factories grow via normal usage,
// no OWNER gate. Factory.name is now unique (03_DATABASE_SCHEMA.md audit, 2026-08-07) — same
// case-insensitive pre-check + P2002 backup pattern already used by Color/Location, for the
// same "Navy" vs "navy" race the pre-check alone can't fully close.
async function createFactory(req, res) {
  const { name, contact, gstNo } = req.body;
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  const trimmed = name.trim();

  const existing = await prisma.factory.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) {
    return sendError(res, 409, 'DUPLICATE_FACTORY', `Factory "${existing.name}" already exists`);
  }

  try {
    const factory = await prisma.factory.create({
      data: { name: trimmed, contact: contact || null, gstNo: gstNo || null },
      select: SELECT,
    });
    res.status(201).json(factory);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_FACTORY', `Factory "${trimmed}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/factories/:id — OWNER only (👑), no PIN — editing factory details (especially
// GST) is administrative, not the pricing-adjacent action the PIN gate exists to protect.
async function updateFactory(req, res) {
  const { id } = req.params;
  const body = req.body;

  const data = {};
  if ('name' in body) data.name = body.name;
  if ('contact' in body) data.contact = body.contact;
  if ('gstNo' in body) data.gstNo = body.gstNo;

  if (Object.keys(data).length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No editable fields provided');
  }
  if ('name' in data && (!data.name || !data.name.trim())) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name cannot be empty');
  }

  const existing = await prisma.factory.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${id}`);
  }

  if ('name' in data) {
    data.name = data.name.trim();
    const nameClash = await prisma.factory.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: id } },
    });
    if (nameClash) {
      return sendError(res, 409, 'DUPLICATE_FACTORY', `Factory "${nameClash.name}" already exists`);
    }
  }

  try {
    const updated = await prisma.factory.update({ where: { id }, data, select: SELECT });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'DUPLICATE_FACTORY', `Factory "${data.name}" already exists`);
    }
    throw err;
  }
}

// PATCH /api/factories/:id/deactivate — any authenticated role (🔒), matching createFactory's
// own gating — deactivate/reactivate is a distinct action from editing GST/contact details
// (which stays OWNER-only via updateFactory above), not a subset of it. Soft-deactivate only,
// NEVER hard-delete — Product/Transaction history traces back through factoryId and must stay
// resolvable forever, same principle as User.isActive. Idempotent: deactivating an
// already-inactive factory just re-confirms the state, not an error. Unlike userController's
// deactivateUser, there is no lockout-prevention guard here — that pair existed specifically
// because the system must never reach zero active OWNER accounts; a Factory has no equivalent
// structural risk (an inactive Factory just means "hidden from daily pickers," nothing breaks).
async function deactivateFactory(req, res) {
  const { id } = req.params;

  const existing = await prisma.factory.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${id}`);
  }

  const factory = await prisma.factory.update({ where: { id }, data: { isActive: false }, select: SELECT });
  res.json(factory);
}

// PATCH /api/factories/:id/reactivate — any authenticated role (🔒). Reverses a deactivation.
async function reactivateFactory(req, res) {
  const { id } = req.params;

  const existing = await prisma.factory.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${id}`);
  }

  const factory = await prisma.factory.update({ where: { id }, data: { isActive: true }, select: SELECT });
  res.json(factory);
}

// GET /api/factories/:id/payable — OWNER only (👑). Computed, not stored: SUM(STOCK_IN
// qtySets × piecesPerSet × costPriceSnapshot) PLUS SUM(FactoryDebit.amount), minus
// SUM(FactoryPayment.amount), all scoped to this Factory. costPriceSnapshot (not a live join
// to Product.costPrice) is what makes the transaction-derived part stable against a later price
// change — see createTransaction for where it's captured. FactoryDebit folds into totalOwed
// itself, not a separate figure alongside it — 05_BUSINESS_RULES.md rule 96 explains why a
// manual "amount owed" entry has to raise the same totalOwed the transaction sum contributes
// to, not sit next to it as something amountPayable would have to separately account for.
//
// correctionAsOriginal: null (added for Transaction Corrections, see transactionCorrectionController.js)
// excludes any STOCK_IN row that has been corrected away. Without this, a correction would double
// the payable figure rather than fix it: the correction's own reversal is a STOCK_OUT (never
// counted here by type alone, same as any ordinary sale/shipment), so the wrongly-recorded
// original would otherwise keep contributing its old, wrong amount forever, on top of whatever
// the corrected replacement STOCK_IN newly contributes. Excluding the superseded original is what
// makes a price/quantity correction actually change this figure instead of just adding to it.
async function getFactoryPayable(req, res) {
  const { id } = req.params;

  const factory = await prisma.factory.findUnique({ where: { id } });
  if (!factory) {
    return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${id}`);
  }

  const stockInTransactions = await prisma.transaction.findMany({
    where: {
      type: 'STOCK_IN',
      correctionAsOriginal: null,
      stock: { bundle: { product: { factoryId: id } } },
    },
    select: {
      qtySets: true,
      costPriceSnapshot: true,
      stock: {
        select: {
          bundle: {
            select: {
              product: {
                select: { isKids: true, sizes: { select: { sizeLabel: true, qty: true } } },
              },
            },
          },
        },
      },
    },
  });

  // A snapshot of null (the article was still pending-price at the moment it was received)
  // contributes 0 forever — correct, not a bug: this transaction genuinely had no recorded
  // cost at receiving time, and a price set weeks later shouldn't retroactively invent one.
  const transactionOwed = stockInTransactions.reduce((sum, t) => {
    const piecesPerSet = piecesPerSetFor(t.stock.bundle.product);
    const price = t.costPriceSnapshot != null ? Number(t.costPriceSnapshot) : 0;
    return sum + t.qtySets * piecesPerSet * price;
  }, 0);

  // wasEdited added to the select for the frontend's "edited" label — an explicit flag now,
  // not inferred from updatedAt-vs-createdAt (see LEARNING_LOG.md for why that heuristic was
  // replaced). createdAt/updatedAt stay selected too — still generically useful, harmless to
  // leave in, no longer load-bearing for the "edited" signal specifically. The
  // totalOwed/totalPaid/amountPayable recompute itself needed no changes at all for edit/delete
  // to work correctly (this whole query already runs fresh, from live rows, on every call; see
  // LEARNING_LOG.md for the explicit verification).
  //
  // orderBy is two levels for the same reason the frontend's merged-history sort is: `date` is
  // the real-world ordering (a backdated entry belongs where its date says), but two entries
  // sharing the exact same date need a tiebreaker, and `createdAt` — set once at insert, never
  // user-edited — is what actually answers "which of these was recorded first." Matches the
  // frontend's own tiebreak logic so this array's order is meaningful even if a future caller
  // reads payments/debits directly instead of going through the merged `history` list.
  const [payments, debits] = await Promise.all([
    prisma.factoryPayment.findMany({
      where: { factoryId: id },
      select: { id: true, amount: true, date: true, note: true, createdAt: true, updatedAt: true, wasEdited: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.factoryDebit.findMany({
      where: { factoryId: id },
      // billNo (2026-08-30) is selected for debits ONLY — FactoryPayment has no such column and
      // deliberately never will: a payment is not tied to exactly one bill (two or three bills
      // routinely get settled with a single lump sum), so a bill reference on a payment row would
      // be actively misleading rather than merely unused. Display-only here — nothing below reads
      // it, and totalDebited/totalOwed/amountPayable are untouched by its presence.
      select: { id: true, amount: true, date: true, note: true, billNo: true, createdAt: true, updatedAt: true, wasEdited: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);

  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const totalDebited = debits.reduce((sum, d) => sum + Number(d.amount), 0);
  const totalOwed = transactionOwed + totalDebited;

  res.json({
    factoryId: id,
    totalOwed,
    totalPaid,
    amountPayable: totalOwed - totalPaid,
    payments,
    debits,
  });
}

module.exports = {
  listFactories,
  createFactory,
  updateFactory,
  deactivateFactory,
  reactivateFactory,
  getFactoryPayable,
  piecesPerSetFor,
};
