const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

const SELECT = { id: true, productId: true, colorId: true };

// GET /api/bundles?productId= — any authenticated role (🔒)
async function listBundles(req, res) {
  const { productId } = req.query;
  if (!productId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'productId query parameter is required');
  }

  const bundles = await prisma.bundle.findMany({ where: { productId }, select: SELECT });
  res.json(bundles);
}

// POST /api/bundles — any authenticated role (🔒), matching Product/Color/Transaction creation
// (see routes/bundles.js — this was incorrectly OWNER-only from the project's second commit
// until fixed; see LEARNING_LOG.md). Pre-checks Product and Color existence explicitly
// (rather than relying on catching Prisma's P2003) because there are TWO foreign keys here —
// a single FK-violation error code can't reliably tell you which of the two failed, so a
// generic 404 would leave the client guessing. The (productId, colorId) uniqueness itself is
// still enforced via catching P2002 on the create, same reasoning as Products/Colors/Locations —
// that's the actual invariant, and catching it is race-safe in a way a pre-check isn't.
async function createBundle(req, res) {
  const { productId, colorId } = req.body;
  if (!productId || !colorId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'productId and colorId are required');
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${productId}`);
  }

  const color = await prisma.color.findUnique({ where: { id: colorId } });
  if (!color) {
    return sendError(res, 404, 'COLOR_NOT_FOUND', `No color with id ${colorId}`);
  }

  try {
    const bundle = await prisma.bundle.create({ data: { productId, colorId }, select: SELECT });
    res.status(201).json(bundle);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(
        res,
        409,
        'DUPLICATE_BUNDLE',
        `Product ${product.articleNo} already has a Bundle for color "${color.name}"`
      );
    }
    throw err;
  }
}

module.exports = { listBundles, createBundle };
