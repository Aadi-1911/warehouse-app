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
    name: true,
    // Round 12: category is now a relation, not a scalar string. `select: { category: true }`
    // would pull every scalar field of the linked row (id, name, isActive) — narrowed to just
    // id/name since isActive isn't meaningful on an already-resolved reference.
    categoryId: true,
    category: { select: { id: true, name: true } },
    isKids: true,
    isActive: true,
    sellingPrice: true,
    ...(role === 'OWNER' ? { costPrice: true } : {}),
    sizes: {
      // qty rides along so any client calling its own piecesPerSetFor (Receive Stock's live
      // readout, New Order, Good Returns) sums real quantities rather than counting rows.
      select: { id: true, sizeLabel: true, sortOrder: true, qty: true },
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

// Receive Stock's New-article form now always sends a real categoryId (required field, backed
// by GET /api/categories) — this fallback is no longer the primary mechanism it was when it was
// first added, just a defensive backend safety net for any caller that omits it (a future
// integration, a direct API call, a raw script). Looked up by name rather than hardcoding the
// seeded id, since nothing guarantees a fixed id across environments beyond what the migration
// seeded on this one.
async function getDefaultCategoryId() {
  const fallback = await prisma.category.findFirst({ where: { name: 'Others' } });
  if (!fallback) {
    // Should be unreachable — "Others" is seeded by the migration itself — but failing loudly
    // here is much clearer than letting a missing categoryId reach Prisma as undefined and
    // produce the same raw "Argument categoryId is missing" crash this fallback exists to avoid.
    throw new Error('Default "Others" Category not found — was the Round 12 migration seed data removed?');
  }
  return fallback.id;
}

// POST /api/products — any authenticated role (🔒) when creating with no price fields, which
// lands the article in the nullable "pending price" state. The moment the body sets
// costPrice/sellingPrice, the route's requireOwnerPinForPriceFields middleware (routes/
// products.js) has already enforced the exact same OWNER+PIN gate PATCH uses — the rule is
// never "creating vs. editing," it's "does this request set a real price." By the time this
// function runs, that check has already passed if it was going to be needed at all.
async function createProduct(req, res) {
  const { articleNo, factoryId, name, categoryId, isKids, costPrice, sellingPrice, sizes } = req.body;

  if (!articleNo || !factoryId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'articleNo and factoryId are required');
  }
  if (!name || !name.trim()) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'name is required');
  }
  if (!Array.isArray(sizes) || sizes.length === 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'sizes must be a non-empty array');
  }
  for (const size of sizes) {
    if (!size || typeof size.sizeLabel !== 'string' || !size.sizeLabel.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each size requires a non-empty sizeLabel');
    }
    // qty is optional (omitted means 1, matching the column default and every pre-qty caller),
    // but when present it must be a positive whole number. Rejecting 0 rather than quietly
    // dropping the row is what enforces ProductSize's "only rows with qty > 0 ever exist"
    // invariant at the API boundary: a zero-qty row would mean "this size is part of the set,
    // zero times", which is exactly the contradiction the invariant exists to prevent. The UI
    // already never sends one (a size stepped down to 0 is omitted from the array entirely) —
    // this is the server-side guarantee for any caller that bypasses it.
    if (size.qty !== undefined && (!Number.isInteger(size.qty) || size.qty < 1)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Each size qty must be a whole number of at least 1');
    }
  }

  try {
    const resolvedCategoryId = categoryId || (await getDefaultCategoryId());
    const product = await prisma.product.create({
      data: {
        articleNo,
        factoryId,
        name: name.trim(),
        categoryId: resolvedCategoryId,
        isKids: !!isKids,
        costPrice,
        sellingPrice,
        sizes: {
          create: sizes.map((s) => ({
            sizeLabel: s.sizeLabel,
            sortOrder: s.sortOrder ?? 0,
            // ?? 1 keeps every pre-qty caller (and any client that doesn't know about repeated
            // sizes) behaving exactly as before — one row, one piece.
            qty: s.qty ?? 1,
          })),
        },
      },
      // Structurally the same "select, don't strip" guarantee as every other Product read —
      // now that STAFF can hit this route too, hardcoding 'OWNER' here would leak costPrice
      // straight back to the STAFF request that just set it (or left it blank).
      select: productSelect(req.user.role),
    });
    res.status(201).json(product);
  } catch (err) {
    // Two different unique constraints can throw the identical P2002 here — (articleNo,
    // factoryId) on Product, or the newer (productId, sizeLabel) on ProductSize, reachable if a
    // caller bypasses the UI's chip-toggle (which can't itself select the same size twice) and
    // posts a duplicate sizeLabel directly. meta.target names which columns were actually
    // violated, so this never mislabels one as the other.
    if (err.code === 'P2002') {
      if (err.meta?.target?.includes?.('sizeLabel')) {
        return sendError(res, 409, 'DUPLICATE_SIZE', 'Each size can only be listed once for an article');
      }
      return sendError(
        res,
        409,
        'DUPLICATE_ARTICLE',
        `Article ${articleNo} already exists for this Factory`
      );
    }
    if (err.code === 'P2003') {
      // Two different foreign keys can throw the identical P2003 here — factoryId or (now)
      // categoryId. err.meta.constraint names the actual constraint that failed (verified
      // empirically: "Product_categoryId_fkey" on this Prisma version — NOT err.meta.field_name,
      // which doesn't exist here despite being the name used in some Prisma docs/versions).
      if (err.meta?.constraint?.includes?.('categoryId')) {
        return sendError(res, 404, 'CATEGORY_NOT_FOUND', `No category with id ${categoryId}`);
      }
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

// PATCH /api/products/:id/deactivate — any authenticated role (🔒), matching createProduct's
// own base gating (any role can create/receive against a Product with no price fields touched;
// deactivate is likewise never a price action). Archives the WHOLE article, all its colors
// together as one unit, per Product.isActive's own schema comment — not per-color. Soft-
// deactivate only, NEVER hard-delete — Bundle/Transaction history traces back through
// productId and must stay resolvable forever, same principle as User.isActive. Idempotent:
// deactivating an already-inactive product just re-confirms the state, not an error. No
// lockout-prevention guard (unlike userController's deactivateUser) — that pair exists
// specifically because the system must never reach zero active OWNER accounts; a Product has
// no equivalent structural risk.
async function deactivateProduct(req, res) {
  const { id } = req.params;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  const product = await prisma.product.update({
    where: { id },
    data: { isActive: false },
    select: productSelect(req.user.role),
  });
  res.json(product);
}

// PATCH /api/products/:id/reactivate — any authenticated role (🔒). Reverses a deactivation.
async function reactivateProduct(req, res) {
  const { id } = req.params;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  const product = await prisma.product.update({
    where: { id },
    data: { isActive: true },
    select: productSelect(req.user.role),
  });
  res.json(product);
}

// `name` added 2026-08-28 (article rename). It sits with categoryId/isKids as an ordinary
// non-price attribute edit, NOT with costPrice/sellingPrice: rule 71's PIN gate is specifically
// about money, and a name carries no financial meaning. The route's own requireRole('OWNER')
// still applies to it unconditionally (see routes/products.js) — that's the established
// convention every other non-price Product edit already follows, confirmed by reading the route
// chain rather than assumed. requirePinForPriceEdits inspects the BODY for price fields only, so
// a name-only PATCH correctly passes through it without ever prompting for a PIN.
//
// Renaming is safe to allow freely precisely because it can no longer rewrite history: every
// Order line, Transfer and Return created from 2026-08-28 onward snapshots the name at creation
// (productNameSnapshot), so this edit only ever changes go-forward display.
//
// articleNo stays permanently un-patchable (rejected explicitly below) — it's the article's
// identity, unique per Factory, and is what every historical record is keyed to reading by.
const PATCHABLE_FIELDS = ['categoryId', 'isKids', 'costPrice', 'sellingPrice', 'name'];

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
  // categoryId is required on Product — unlike costPrice/sellingPrice (genuinely nullable,
  // "pending" states), there's no valid empty value to patch it to.
  if ('categoryId' in data && !data.categoryId) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'categoryId cannot be empty');
  }
  // Same required-field reasoning as categoryId above: Product.name is non-nullable in the
  // schema, so there's no valid empty value. Trimmed before the length check AND before writing,
  // so " " is rejected rather than silently stored as a blank-looking name, and a name with
  // accidental padding is normalised the same way createProduct already normalises its own.
  if ('name' in data) {
    data.name = String(data.name ?? '').trim();
    if (!data.name) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'name cannot be empty');
    }
  }

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  try {
    const updated = await prisma.product.update({
      where: { id },
      data,
      select: productSelect(req.user.role), // OWNER here — requireRole('OWNER') already gated this route
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2003') {
      return sendError(res, 404, 'CATEGORY_NOT_FOUND', `No category with id ${data.categoryId}`);
    }
    throw err;
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
  getValidColors,
  productSelect,
};
