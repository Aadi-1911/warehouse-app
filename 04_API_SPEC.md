# API Specification — Phase 1
## Wholesale Garment Business Management System

All endpoints are prefixed `/api`. All responses are JSON. All authenticated endpoints require a valid session/JWT (see `02_ARCHITECTURE.md`, Section 4). Role restrictions are enforced server-side, never trust the frontend.

**Legend:** 🔒 = requires auth (any role) · 👑 = OWNER only · 📌 = OWNER only, PIN required

---

## Auth

### `POST /api/auth/login`
Body: `{ username, password }`
Response: `{ token, user: { id, name, role } }` (or session cookie, depending on chosen auth strategy)
Errors: `401` invalid credentials.

### `POST /api/auth/logout` 🔒
Invalidates the current session/token.

---

## Users 👑

### `GET /api/users` 👑
Response: list of `{ id, name, username, role }` — never include `passwordHash` or `priceEditPinHash`.

### `POST /api/users` 👑
Body: `{ name, username, password, role }`
Creates a new User. Password is hashed server-side before storage.

---

## Factories 🔒

### `GET /api/factories` 🔒
Response: `[{ id, name, contact }]`

### `POST /api/factories` 🔒
Body: `{ name, contact? }`
Any authenticated user can add a Factory (they grow over time via normal usage).

---

## Colors 🔒

### `GET /api/colors` 🔒
Response: `[{ id, name }]`

### `POST /api/colors` 🔒
Body: `{ name }`
Validation: name must be unique (case-insensitive recommended, to avoid "Navy" vs "navy" duplicates).

---

## Locations 🔒

### `GET /api/locations` 🔒
Response: `[{ id, name }]`

### `POST /api/locations` 👑
Body: `{ name }`

---

## Products (Articles)

### `GET /api/products` 🔒
Response for STAFF role: `[{ id, articleNo, factoryId, category, sellingPrice, sizes: [...] }]` — **`costPrice` field must be omitted entirely, not just null, for STAFF-role requests.**
Response for OWNER role: same, plus `costPrice`.
Query params: `?factoryId=`, `?articleNo=` for filtering.

### `GET /api/products/:id` 🔒
Same visibility rule as above, single record.

### `POST /api/products` 👑
Body: `{ articleNo, factoryId, category?, costPrice, sellingPrice, sizes: [{ sizeLabel, sortOrder }] }`
Validation: `(articleNo, factoryId)` combination must be unique — return `409` on conflict with a clear message (e.g. "Article {articleNo} already exists for this Factory").
Creating a Product does NOT require the PIN gate — only *editing* price fields on an existing Product does (see below).

### `PATCH /api/products/:id` 📌
Body: any subset of editable fields.
**If the body includes `costPrice` or `sellingPrice`:** request must also include `{ pin: "<owner's PIN>" }`. Server verifies `role == OWNER` AND PIN match against `priceEditPinHash` before applying the price change. Reject with `403` if either check fails — do not partially apply the update.
Non-price fields (category, etc.) can be edited by OWNER without the PIN.

### `GET /api/products/:id/valid-colors` 🔒
Returns only the Colors that have an existing `Bundle` for this Product — used to populate the color dropdown at stock-entry time.
Response: `[{ id, name, bundleId }]`

---

## Bundles 🔒

### `POST /api/bundles` 👑
Body: `{ productId, colorId }`
Creates a Product+Color combination. Validation: `(productId, colorId)` must be unique — `409` on conflict.

### `GET /api/bundles?productId=` 🔒
Lists Bundles for a given Product (i.e. its valid colors) — can also be served via the `/products/:id/valid-colors` shortcut above.

---

## Stock (read)

### `GET /api/stock` 🔒
Query params: `?articleNo=`, `?colorId=`, `?locationId=` — supports the Live Stock View's search/filter requirement.
Response: `[{ bundleId, productArticleNo, colorName, locationName, qtySets, qtyReservedForSample }]`
**No direct write endpoint exists for Stock** — quantities only change via `POST /api/transactions` (see below). This is intentional; do not add a `PATCH /api/stock/:id`.

---

## Transactions (the only way stock quantities change)

### `POST /api/transactions` 🔒
Body: `{ bundleId, locationId, type, qtySets, note? }`
`type ∈ { STOCK_IN, STOCK_OUT, SAMPLE_OUT, SAMPLE_RETURN }`

Server-side logic (must be atomic — a single DB transaction):
1. Validate `(bundleId, colorId)` pairing is real (Bundle exists for that Product+Color).
2. Find or create the corresponding `Stock` row for `(bundleId, locationId)`.
3. Apply the quantity change based on `type`:
   - `STOCK_IN`: `qtySets += body.qtySets`
   - `STOCK_OUT`: `qtySets -= body.qtySets` (reject if this would go negative — return `400`)
   - `SAMPLE_OUT`: `qtySets -= body.qtySets`, `qtyReservedForSample += body.qtySets` (reject if `qtySets` would go negative)
   - `SAMPLE_RETURN`: `qtyReservedForSample -= body.qtySets`, `qtySets += body.qtySets` (reject if `qtyReservedForSample` would go negative)
4. Insert the `Transaction` row with `userId` from the authenticated session, `createdAt = now()`.
5. Both the Stock update and Transaction insert must succeed or fail together (single DB transaction, not two separate writes).

Response: `{ transaction: {...}, updatedStock: {...} }`
Errors: `400` for any quantity that would go negative; `404` if Bundle/Location doesn't exist.

### `GET /api/transactions` 🔒
Query params: `?bundleId=`, `?locationId=`, `?userId=`, `?from=`, `?to=` — for audit/history views.
Response: list of Transaction records with joined user name, bundle/product/color info for display.

---

## General Error Conventions

- `400` — validation failure (bad input shape, would-be-negative stock, etc.)
- `401` — not authenticated
- `403` — authenticated but not authorized for this action (wrong role, missing/invalid PIN)
- `404` — resource not found
- `409` — uniqueness conflict (duplicate article+factory, duplicate product+color, duplicate color name)

All error responses: `{ error: { code, message } }` — keep messages specific enough to debug (e.g. name the conflicting field), never generic "something went wrong."
