const { PrismaClient } = require('@prisma/client');
const { sendError } = require('../utils/errors');

const prisma = new PrismaClient();

// costPrice is only added to the select when the requester is OWNER — for STAFF the field is
// never fetched from Postgres at all, so it can't end up in the response object by any path
// (not "select everything, then delete the key before responding").
//
// As of rule 111 (2026-09-23) the same guarantee has to hold one level deeper. LocationPrice
// carries its OWN costPrice column, so a `locationPrices: true` anywhere in this select would hand
// STAFF every location's cost price through the relation — a complete bypass of CLAUDE.md's first
// non-negotiable rule, arrived at without ever mentioning the word costPrice at the top level.
//
// The fix is the same never-fetch discipline, applied to the nested select: locationPrices always
// comes back with an explicit field list, and costPrice joins that list only for an OWNER. STAFF
// still receives the rows (sellingPrice is not restricted — rule 10 only ever restricts cost), but
// the cost column is never read out of Postgres for them in the first place.
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
    // Rule 111. Purely additive for every existing caller — a client that ignores these two fields
    // is unaffected, and hasLocationPricing is false on every pre-existing article anyway.
    //
    // No role branch on the nested rows, unlike Product.costPrice above: a LocationPrice carries
    // SELLING price only (cost is global, rule 111 as revised 2026-09-25), and selling price has
    // always been visible to STAFF — they quote it. The nested costPrice that existed here between
    // 2026-09-23 and 2026-09-25 was gated; there is now no cost field on this relation to gate.
    hasLocationPricing: true,
    locationPrices: {
      select: {
        id: true,
        locationId: true,
        location: { select: { id: true, name: true } },
        sellingPrice: true,
      },
      // Stable ordering so a client rendering a per-location price grid gets the same row order on
      // every request, rather than whatever Postgres returns. By location name, matching the
      // alphabetical convention every other location-grouped surface in this app already uses.
      orderBy: { location: { name: 'asc' } },
    },
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
//
// Also requires at least one real Stock row for that Bundle (rule 107, built 2026-09-18) — a
// Bundle with no stock anywhere (every Stock row at qtySets = 0, or no Stock row at all) is
// suppressed from this picker the same as every other browsing surface rule 107 names. This is
// the one surface where the suppression IS the query itself, rather than a client-side filter
// on top of an unfiltered fetch — New Order asks for one Product's colors at a time, so there's
// no shared unfiltered payload another screen also depends on the way GET /api/stock has.
async function getValidColors(req, res) {
  const { id } = req.params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  const bundles = await prisma.bundle.findMany({
    where: { productId: id, stock: { some: { qtySets: { gt: 0 } } } },
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

// PUT /api/products/:id/location-prices/:locationId — OWNER + PIN, UNCONDITIONALLY (rule 111).
// Sets or clears this article's per-location SELLING price override.
//
// SELLING ONLY. Cost is global (rule 111 as revised 2026-09-25) — there is no per-location cost
// to write. A body carrying `costPrice` is REJECTED with 400, never silently ignored: a money
// endpoint that accepts a price field and quietly drops it is the worst available failure mode,
// since the caller gets a 200 and reasonably believes a cost was recorded.
//
// WHY THIS IS A SEPARATE ENDPOINT WITH ITS OWN UNCONDITIONAL GATE, and not a nested field on
// PATCH /api/products/:id — this is the single most important safety decision in rule 111, so it
// is written down rather than left to be re-derived:
//
// routes/products.js decides whether a PATCH needs a PIN by inspecting the body shape:
//     const editingPrice = 'costPrice' in req.body || 'sellingPrice' in req.body;
// That check is correct for the body it was written for, and silently WRONG for a nested one. Had
// location prices been folded into PATCH as, say, { locationPrices: [{ locationId, sellingPrice }] },
// then `'sellingPrice' in req.body` is FALSE — the price is one level down — and the PIN gate would
// not fire at all. An OWNER could rewrite every location's selling price with no PIN, straight
// through a route that looks PIN-protected, breaking CLAUDE.md's non-negotiable rule ("requires
// OWNER role AND a separate PIN match, never role alone") without anyone touching the PIN code.
//
// The fix is not to teach that conditional check about nested shapes — that's more logic to get
// subtly wrong on the next body shape. It's to give price writes their own route whose gate is
// unconditional: requireAuth → requireRole('OWNER') → requirePin, with no branch to bypass. The
// body here is deliberately FLAT ({ sellingPrice }) so it is impossible for a future edit to hide
// a price field from a body-shape inspection again.
//
// PUT, not PATCH, because the target is a whole override row keyed by (productId, locationId) and
// the operation is an upsert of that row — there is no partial-identity case. sellingPrice is
// REQUIRED (there is no second field left to make it optional against), and null is its explicit
// "clear this override, fall back to the price the order was placed at" value.
async function setLocationPrice(req, res) {
  const { id, locationId } = req.params;
  const body = req.body || {};

  // Rejected LOUDLY, not ignored. Between 2026-09-23 and 2026-09-25 this endpoint accepted a
  // costPrice; a client still sending one is working from the old contract and must be told, not
  // silently given a 200 for a write that never happened.
  if ('costPrice' in body) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'costPrice is not accepted here — cost is global (rule 111). Set it via PATCH /api/products/:id.'
    );
  }

  // Explicit null is meaningful and is NOT the same as omitting the key: null clears the override
  // (fall back to the line's priceAtOrder at billing), omission is simply a missing required
  // field. `in` is what distinguishes them — a truthiness or `!= null` check would collapse both
  // into "not provided" and make it impossible to ever remove an override once set.
  if (!('sellingPrice' in body)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'sellingPrice is required (send null to clear the override)');
  }
  const value = body.sellingPrice;
  // null passes (the explicit "clear this override" signal). Anything else must be a real
  // non-negative number — never a numeric string, matching how every other money field in this
  // API validates.
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'sellingPrice must be a non-negative number, or null to clear it');
  }

  // Both parents verified before the upsert, so a bad id produces a clear 404 rather than a raw
  // Prisma P2003 foreign-key error. An ARCHIVED location is deliberately still allowed: archiving
  // hides a location from daily pickers (rule 85) but it can still hold real stock, and correcting
  // the price attached to that stock is legitimate — this is a price-book edit, not stock movement.
  const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!product) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
  if (!location) {
    return sendError(res, 404, 'LOCATION_NOT_FOUND', `No location with id ${locationId}`);
  }

  // Upsert, so the caller never has to know whether an override row already exists — "set Delhi's
  // price for this article" is one request either way.
  const saved = await prisma.locationPrice.upsert({
    where: { productId_locationId: { productId: id, locationId } },
    update: { sellingPrice: value },
    create: { productId: id, locationId, sellingPrice: value },
    select: {
      id: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      sellingPrice: true,
      updatedAt: true,
    },
  });

  res.json(saved);
}

// PATCH /api/products/:id/location-pricing — OWNER only, deliberately NO PIN (rule 111).
//
// The PIN gate exists for MONEY (rule 71), and this flag writes no money: it decides which
// already-PIN-gated value gets read, and every value it can select between was itself only ever
// writable behind a PIN (Product.costPrice/sellingPrice via PATCH /api/products/:id, and
// LocationPrice.sellingPrice via the PUT above). Turning the toggle on can therefore only ever
// surface a price an OWNER already entered with a PIN; it cannot introduce a number nobody
// authorised. That is the same reasoning that leaves `name`, `categoryId` and `isKids` PIN-free
// on an OWNER-gated route.
//
// Worth stating plainly because the opposite reading is tempting: flipping this DOES change what a
// party is charged on the next order. The judgement is that the PIN protects the act of setting a
// price, not every operation whose outcome a price affects — otherwise billing itself would need
// one.
async function setLocationPricingEnabled(req, res) {
  const { id } = req.params;
  const { hasLocationPricing } = req.body || {};

  // Strict boolean, not truthy — same reasoning as billOrder's `locationConfirmed !== true`: a
  // stray "false" string or a 1 must not decide which price the business charges.
  if (typeof hasLocationPricing !== 'boolean') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'hasLocationPricing must be a boolean');
  }

  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return sendError(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}`);
  }

  // Turning it OFF deliberately does not delete a single LocationPrice row — see the flag's own
  // schema comment. Off means dormant, and flipping it back on restores exactly the prices that
  // were there before, with nothing to re-enter.
  const updated = await prisma.product.update({
    where: { id },
    data: { hasLocationPricing },
    select: productSelect(req.user.role), // OWNER — requireRole('OWNER') already gated this route
  });

  res.json(updated);
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  reactivateProduct,
  getValidColors,
  setLocationPrice,
  setLocationPricingEnabled,
  productSelect,
};
