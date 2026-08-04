const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// costPrice is only added to the select when the requester is OWNER — for STAFF the field is
// never fetched from Postgres at all, so it can't end up in the response object by any path
// (not "select everything, then delete the key before responding").
function productSelect(role) {
  return {
    id: true,
    articleNo: true,
    factoryId: true,
    category: true,
    sellingPrice: true,
    ...(role === 'OWNER' ? { costPrice: true } : {}),
    sizes: {
      select: { id: true, sizeLabel: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    },
  };
}

// GET /api/products — any authenticated role (🔒)
async function listProducts(req, res) {
  const { factoryId, articleNo } = req.query;

  const where = {};
  if (factoryId) where.factoryId = factoryId;
  if (articleNo) where.articleNo = { contains: articleNo, mode: 'insensitive' };

  const products = await prisma.product.findMany({
    where,
    select: productSelect(req.user.role),
  });

  res.json(products);
}

// GET /api/products/:id — any authenticated role (🔒)
async function getProduct(req, res) {
  const { id } = req.params;

  const product = await prisma.product.findUnique({
    where: { id },
    select: productSelect(req.user.role),
  });

  if (!product) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  res.json(product);
}

// POST /api/products — OWNER only (👑), no PIN — creating a new article isn't editing an
// existing price, so §4.3's PIN gate doesn't apply here (only PATCH triggers it).
async function createProduct(req, res) {
  const { articleNo, factoryId, category, costPrice, sellingPrice, sizes } = req.body;

  if (!articleNo || !factoryId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'articleNo and factoryId are required');
  }
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'sizes must be a non-empty array');
  }
  for (const size of sizes) {
    if (!size || typeof size.sizeLabel !== 'string' || !size.sizeLabel.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each size requires a non-empty sizeLabel');
    }
  }

  try {
    const product = await prisma.product.create({
      data: {
        articleNo,
        factoryId,
        category,
        costPrice,
        sellingPrice,
        sizes: { create: sizes.map((s) => ({ sizeLabel: s.sizeLabel, sortOrder: s.sortOrder ?? 0 })) },
      },
      select: productSelect('OWNER'), // requireRole('OWNER') already gated this route
    });
    res.status(201).json(product);
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(
        res,
        409,
        'DUPLICATE_ARTICLE',
        `Article ${articleNo} already exists for this Factory`
      );
    }
    if (err.code === 'P2003') {
      return sendError(res, 404, 'FACTORY_NOT_FOUND', `No factory with id ${factoryId}`);
    }
    throw err;
  }
}

// GET /api/products/:id/valid-colors — any authenticated role (🔒). A Color only appears here
// if a Bundle actually links it to this specific Product — this is the same "only Colors with a
// real Bundle for this Product are valid" rule 02_ARCHITECTURE.md §5 requires the Transaction
// endpoint to enforce, just surfaced as a read endpoint for populating a dropdown at entry time.
async function getValidColors(req, res) {
  const { id } = req.params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  const bundles = await prisma.bundle.findMany({
    where: { productId: id },
    select: { id: true, color: { select: { id: true, name: true } } },
  });

  // Flattened to exactly 04_API_SPEC.md's shape — colorId/colorName aren't nested under a
  // `color` key, and bundleId sits alongside them so a client can go straight from this list
  // into POST /api/transactions without a second lookup.
  const response = bundles.map((b) => ({ id: b.color.id, name: b.color.name, bundleId: b.id }));

  res.json(response);
}

const PATCHABLE_FIELDS = ['category', 'isKids', 'costPrice', 'sellingPrice'];

// PATCH /api/products/:id — OWNER only always (📌); PIN additionally required when the body
// touches costPrice/sellingPrice (enforced by the requirePinForPriceEdits middleware in the
// route chain, which runs BEFORE this handler — so if we're here, either no price fields were
// touched, or role+PIN were both already verified).
async function updateProduct(req, res) {
  const { id } = req.params;
  const body = req.body;

  if ('articleNo' in body || 'factoryId' in body) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'articleNo and factoryId cannot be changed after creation'
    );
  }

  const data = {};
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) data[field] = body[field];
  }

  if (Object.keys(data).length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'No editable fields provided');
  }

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  const updated = await prisma.product.update({
    where: { id },
    data,
    select: productSelect(req.user.role), // OWNER here — requireRole('OWNER') already gated this route
  });

  res.json(updated);
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, getValidColors, productSelect };
