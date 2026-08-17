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
Response: list of `{ id, name, username, role, isActive, isPrimaryOwner }` — never include `passwordHash` or `priceEditPinHash`.

### `POST /api/users` 👑
Body: `{ name, username, password, role }`
Creates a new User. Password is hashed server-side before storage. New account always starts with `priceEditPinHash: null` — the owner sets their own PIN themselves, self-service, never set by the creator.
**If `role: "OWNER"` is requested, the requester must have `isPrimaryOwner: true`** (checked server-side, re-fetched from DB, not trusted from the JWT — same pattern as every other role check). A non-primary owner attempting to create another OWNER account gets `403`. Any owner (primary or not) can create STAFF accounts.

### `PATCH /api/users/:id/deactivate` 👑
Sets `isActive: false`. **Never hard-delete a User** — Transaction and History records reference `userId` and must stay resolvable forever, per the audit-trail principle. A deactivated user can't log in (`auth.js` must check `isActive` on every login and every token verification, not just at login time) but their historical records stay fully intact and correctly attributed.
**Two guards, both required, closing a real total-lockout risk:** (1) a user can never deactivate their own currently-logged-in account — reject with `403`. (2) deactivating the last remaining `isActive: true` OWNER-role account is rejected with `403`, regardless of primary status — the system must never be able to reach zero active owners through the API, since only a primary owner can create a new one and only an active owner can reactivate anyone.

### `PATCH /api/users/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

### `PATCH /api/users/me/pin` 🔒 (OWNER only)
Body: `{ newPin, currentPin? }`. Self-service PIN set/change — **the only way a PIN is ever set, never done by whoever created the account.** If `priceEditPinHash` is currently null (first-time setup), `currentPin` is not required. If a PIN already exists, `currentPin` must be provided and verified before the new one is accepted — same reasoning as a password change, prevents someone with just an active session from silently changing the PIN.

### `PATCH /api/users/:id/password` 📌
Body: `{ newPassword, pin }`. **Admin password reset — not self-service.** The `pin` verified is the *requester's own* PIN (same `req.user.id` lookup as every other PIN gate), not the target's — it proves who's making the change, not knowledge of the target's current password. This is deliberately the only way to give someone a working login again: there's no separate "forgot password" flow, and no `currentPassword` check, because the whole point is handing out a new password to someone who doesn't have (or doesn't remember) the old one.
Resetting your own password through this endpoint is allowed — an active session plus a correct PIN is at least as strong as a typical self-service "enter current password" check.
**Resetting a different OWNER's password requires `isPrimaryOwner: true`** on the requester — same restriction as `POST /api/users`' OWNER-creation gate (rule 74), extended here because letting any secondary OWNER reset another OWNER's password (including the primary owner's) would be a full account takeover, not just an unwanted permission grant. Resetting a STAFF account's password has no such restriction — any OWNER, primary or not, can do it.
Response: `{ id, name, username, role, isActive, isPrimaryOwner }` — same shape as `GET /api/users`, no password fields.

---

## Factories 🔒

### `GET /api/factories` 🔒
Response: `[{ id, name, contact, gstNo, isActive }]`

### `POST /api/factories` 🔒
Body: `{ name, contact?, gstNo? }`
Any authenticated user can add a Factory (they grow over time via normal usage).

### `PATCH /api/factories/:id` 👑
Body: any subset of `{ name, contact, gstNo }`. Owner-only — editing factory details (especially GST) is administrative, not routine staff work.

### `PATCH /api/factories/:id/deactivate` 🔒
Sets `isActive: false`. **Never hard-delete a Factory** — Product/Transaction history traces back through `factoryId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Any authenticated role — matches `POST /api/factories`' own gating, not the field-edit PATCH above (deactivate is a distinct action, not a subset of editing GST/contact). Idempotent. **No lockout-prevention guard** — unlike Users, there's no equivalent risk (an inactive Factory just means "hidden from daily pickers, still fully accessible").

### `PATCH /api/factories/:id/reactivate` 🔒
Sets `isActive: true` — reverses a deactivation.

### `GET /api/factories/:id/payable` 👑
Response: `{ factoryId, totalOwed, totalPaid, amountPayable, payments: [{ id, amount, date, note, createdAt, updatedAt, wasEdited }], debits: [{ id, amount, date, note, createdAt, updatedAt, wasEdited }] }`
**Owner-only, not any-role** — corrected from an earlier draft. This total is computed from `costPriceSnapshot`, and staff already know exact quantities received (they log the STOCK_IN transactions themselves), so an open payable figure would be trivially reverse-engineerable into the actual cost price per piece — the same information the PIN gate and role check exist to protect, just reached through arithmetic instead of a direct field read.
`totalOwed` = `SUM(STOCK_IN transactions' qtySets × piecesPerSet × costPriceSnapshot)` **plus** `SUM(FactoryDebit.amount)`, both scoped to this Factory. `amountPayable` = `totalOwed − SUM(FactoryPayment.amount)`, unchanged in shape. `debits` exists so a real, manually-recorded amount owed (05_BUSINESS_RULES.md rule 96) is visible the same way `payments` already is, not just folded invisibly into the `totalOwed` figure. Lightweight, same pattern as the party-facing dues tracker — not a formal ledger. **Requires no special handling for edits/deletes** — this whole response is recomputed fresh from live rows on every call (no caching layer anywhere in the chain), so an edited or deleted `FactoryPayment`/`FactoryDebit` is correctly reflected on the very next call, verified explicitly rather than assumed when PATCH/DELETE were added below. `wasEdited` is an explicit boolean a client reads directly for an "edited" indicator — **not** inferred by comparing `createdAt`/`updatedAt`, which both remain in the response as generically useful metadata but are no longer load-bearing for that signal (an earlier updatedAt-vs-createdAt-plus-60-seconds heuristic missed a real edit made within a minute of creation; see LEARNING_LOG.md).

### `POST /api/factory-payments` 📌
Body: `{ factoryId, amount, date, note?, pin }`
Records a payment made to a Factory, reducing `amountPayable`. Owner-only, mirrors the reasoning for Payment allocation being a deliberate, logged action. **PIN required as of the Factory Payables screen** (§5.8 of `07_UI_DESIGN_BRIEF.md`) — originally shipped role-only, revisited so a real financial action isn't gated by role alone, same `requirePin` middleware and lockout behavior as price edits. `403` on missing/invalid/locked PIN, same codes as `PATCH /api/products/:id`. Response includes `wasEdited: false` — always false for a freshly-created entry.

### `PATCH /api/factory-payments/:id` 📌
Body: any subset of `{ amount, date, note }`, plus `pin` (always required — see below).
Corrects a previously-recorded payment. **Unlike `PATCH /api/products/:id`, the PIN is required unconditionally, not only when specific fields are touched** — every field on this resource (`amount`/`date`/`note`) is itself a financial detail, so there's no non-sensitive subset of an edit that could skip the PIN the way editing a Product's `categoryId` alone can. Sets `wasEdited: true` unconditionally whenever a real edit is saved — explicit, not inferred from timestamps, and never reset back to `false` once set. `404 FACTORY_PAYMENT_NOT_FOUND` if the id doesn't exist.

### `DELETE /api/factory-payments/:id` 📌
No body beyond `{ pin }` (always required, same unconditional gating as PATCH above). **A genuine hard delete** — the first one in this API. Safe specifically because nothing else in the schema references `FactoryPayment` by foreign key (unlike Factory/Product/User/Location/Party/Category, which all use soft-deactivate via `isActive` because other rows trace back through them and must stay resolvable forever). Returns `204` with no body on success. `404 FACTORY_PAYMENT_NOT_FOUND` if the id doesn't exist.

### `POST /api/factory-debits` 📌
Body: `{ factoryId, amount, date, note?, pin }`
Records a manual increase to amount owed to a Factory — the mirror of `POST /api/factory-payments` in the other direction. Same gating as the payment endpoint (Owner + PIN, identical `requirePin` behavior and error codes), since this is an equally sensitive financial action, just moving `amountPayable` up instead of down. Exists specifically for real, pre-app debt that has no corresponding STOCK_IN transaction history in this system (05_BUSINESS_RULES.md rule 96) — without it, a factory in that position has no way to reach a correct `amountPayable`, since `totalOwed` would otherwise only ever reflect stock received *through the app*.

### `PATCH /api/factory-debits/:id` 📌
Identical shape and reasoning to `PATCH /api/factory-payments/:id` above, for the reverse-direction entity. `404 FACTORY_DEBIT_NOT_FOUND` if the id doesn't exist.

### `DELETE /api/factory-debits/:id` 📌
Identical shape and reasoning to `DELETE /api/factory-payments/:id` above. `404 FACTORY_DEBIT_NOT_FOUND` if the id doesn't exist.

---

## Colors 🔒

### `GET /api/colors` 🔒
Response: `[{ id, name, isActive }]`

### `POST /api/colors` 🔒
Body: `{ name }`
Validation: name must be unique (case-insensitive recommended, to avoid "Navy" vs "navy" duplicates).

### `PATCH /api/colors/:id/deactivate` 🔒
Sets `isActive: false`. **Never hard-delete a Color** — Bundle rows reference `colorId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Any authenticated role — matches `POST /api/colors`' own gating. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/colors/:id/reactivate` 🔒
Sets `isActive: true` — reverses a deactivation.

---

## Categories 🔒

### `GET /api/categories` 🔒
Response: `[{ id, name, isActive }]`

### `POST /api/categories` 🔒
Body: `{ name }`
Validation: name must be unique (case-insensitive recommended, to avoid "Hoodie" vs "hoodie" duplicates). Mirrors `POST /api/colors` exactly.

### `PATCH /api/categories/:id/deactivate` 🔒
Sets `isActive: false`. **Never hard-delete a Category** — Product rows reference `categoryId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Any authenticated role — matches `POST /api/categories`' own gating. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case. Closes rule 85's remaining gap — the last of the six archivable entities to get this.

### `PATCH /api/categories/:id/reactivate` 🔒
Sets `isActive: true` — reverses a deactivation.

---

## Locations 🔒

### `GET /api/locations` 🔒
Response: `[{ id, name, isActive }]`

### `POST /api/locations` 👑
Body: `{ name }`

### `PATCH /api/locations/:id/deactivate` 👑
Sets `isActive: false`. **Never hard-delete a Location** — Stock/Transaction rows reference `locationId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Owner-only — matches `POST /api/locations`' own gating, unlike Factory/Color/Product which are open to any role. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/locations/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

---

## Products (Articles)

### `GET /api/products` 🔒
Response for STAFF role: `[{ id, articleNo, name, factoryId, categoryId, category: { id, name }, isActive, sellingPrice, sizes: [...] }]` — **`costPrice` field must be omitted entirely, not just null, for STAFF-role requests.**
Response for OWNER role: same, plus `costPrice`.
Query params: `?factoryId=`, `?articleNo=` for filtering.
Note (Round 12): `category` was a nullable free-text string; it is now a required relation to `Category`, returned as a nested `{ id, name }` object, not a raw string.

### `GET /api/products/:id` 🔒
Same visibility rule as above, single record.

### `POST /api/products` 🔒 (📌 required only if price fields are included — see below)
Body: `{ articleNo, name, factoryId, categoryId?, costPrice?, sellingPrice?, sizes: [{ sizeLabel, sortOrder }] }`
**Any authenticated role can create a Product with no price fields** — this lands the article in the pending-price state (rule 8), which is the normal path for staff creating new articles during Receive Stock.
**If the body includes `costPrice` or `sellingPrice`, the same rule as editing applies: OWNER role AND a PIN match are both required** (`{ pin: "<owner's PIN>" }` in the body), exactly as PATCH requires below. The distinction is never "creating vs. editing" — it's "does this request set a real price," and that's always OWNER+PIN, no exception for it happening at creation time.
`categoryId` should always be a real value from `GET /api/categories` — Receive Stock's New-article form requires picking one (Kids-toggle smart-defaults it to "Kids", but it stays changeable). It remains technically optional at the API layer only as a defensive fallback: an omitted value is silently assigned the "Others" Category rather than failing the request outright, for any caller other than the current UI (a future integration, a direct API call).
Validation: `(articleNo, factoryId)` combination must be unique — return `409` on conflict with a clear message (e.g. "Article {articleNo} already exists for this Factory"); `categoryId`, if provided, must reference a real Category — return `404 CATEGORY_NOT_FOUND` otherwise.

### `PATCH /api/products/:id` 📌
Body: any subset of editable fields.
**If the body includes `costPrice` or `sellingPrice`:** request must also include `{ pin: "<owner's PIN>" }`. Server verifies `role == OWNER` AND PIN match against `priceEditPinHash` before applying the price change. Reject with `403` if either check fails — do not partially apply the update.
Non-price fields (`categoryId`, etc.) can be edited by OWNER without the PIN. `categoryId` cannot be patched to empty (it's a required field, unlike the nullable price fields) — return `400` if attempted.

### `PATCH /api/products/:id/deactivate` 🔒
Sets `isActive: false`. Archives the WHOLE article, all its colors together as one unit — not per-color (`Product.isActive`'s own schema comment). **Never hard-delete a Product** — Bundle/Transaction history traces back through `productId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Any authenticated role — matches `POST /api/products`' own base gating (never a price action, so never OWNER+PIN-gated like the field-edit PATCH above). Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/products/:id/reactivate` 🔒
Sets `isActive: true` — reverses a deactivation.

### `GET /api/products/:id/valid-colors` 🔒
Returns only the Colors that have an existing `Bundle` for this Product — used to populate the color dropdown at stock-entry time.
Response: `[{ id, name, bundleId }]`

---

## Parties 🔒

### `GET /api/parties` 🔒
Response: `[{ id, name, shopName, location, address, contact, gstNo, isActive }]`

### `POST /api/parties` 👑
Body: `{ name, shopName?, location?, address?, contact?, gstNo? }`
`name` required, rest optional per the schema's minimal Phase 1 Party form. Owner-only — unlike Factory/Color/Category (open to any role), Party is treated like Location, a customer/shop-relationship record rather than a casual lookup list.
Validation: `name` must be unique (case-insensitive, same pattern as Color/Category/Location) — return `409` on conflict, not a generic error. **Note:** unlike Color/Factory, `Party.name` has no DB-level unique index yet, so this is an application-level check only — a real (if narrow) race window exists until a schema migration adds one.

### `PATCH /api/parties/:id/deactivate` 👑
Sets `isActive: false`. **Never hard-delete a Party** — Transaction/PartyStockReturn rows reference `partyId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Owner-only — Party has no existing creation endpoint to mirror gating from, so this was decided independently, treating a customer/shop-relationship record like Location rather than the more casual Color/Factory lookup lists. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/parties/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

---

## Bundles 🔒

### `POST /api/bundles` 🔒
Body: `{ productId, colorId }`
Creates a Product+Color combination. Validation: `(productId, colorId)` must be unique — `409` on conflict.
**Any authenticated role** — matches `POST /api/products`/`POST /api/colors`/`POST /api/transactions`, the other three steps of the same "staff receives a brand-new article" flow (rule 71). A Bundle carries no price. *(Corrected from an incorrect `👑` that stood from this project's second commit — see `LEARNING_LOG.md` for the full incident writeup.)*

### `GET /api/bundles?productId=` 🔒
Lists Bundles for a given Product (i.e. its valid colors) — can also be served via the `/products/:id/valid-colors` shortcut above.

---

## Stock (read)

### `GET /api/stock` 🔒
Query params: `?articleNo=`, `?colorId=`, `?locationId=` — supports the Live Stock View's search/filter requirement.
Response: `[{ bundleId, productId, productArticleNo, factoryId, factoryName, colorName, locationId, locationName, qtySets }]`
**No direct write endpoint exists for Stock** — quantities only change via `POST /api/transactions` (see below). This is intentional; do not add a `PATCH /api/stock/:id`.
`factoryId`/`factoryName` added for §5.9's Factory-grouped Transfer picker — every row already traces back through a Product to exactly one Factory, so this is a same-query addition, not a new join. Existing callers unaffected.

---

## Transactions (the only way stock quantities change)

### `POST /api/transactions` 🔒
Body: `{ bundleId, locationId, type, qtySets, note? }`
`type ∈ { STOCK_IN, STOCK_OUT }`
The `TransactionType` database enum also declares `DEFECT_RETURN` and `PARTY_RETURN`, but this endpoint rejects both with a `400` until their stock-movement semantics are actually designed (Phase 4 / party returns respectively). Sample tracking — `SAMPLE_OUT`, `SAMPLE_RETURN`, and `qtyReservedForSample` — was removed entirely with no replacement (`05_BUSINESS_RULES.md` rule 84).
`TRANSFER_OUT`/`TRANSFER_IN` are **also rejected here, permanently** — not because they're unbuilt, but because they are only ever valid as an atomically-created *pair*. They have exactly one door: `POST /api/transfers` (below). Accepting a lone `TRANSFER_OUT` here would let stock leave a location without arriving anywhere.

Server-side logic (must be atomic — a single DB transaction):
1. Validate `(bundleId, colorId)` pairing is real (Bundle exists for that Product+Color).
2. Find or create the corresponding `Stock` row for `(bundleId, locationId)`.
3. Apply the quantity change based on `type`:
   - `STOCK_IN`: `qtySets += body.qtySets`
   - `STOCK_OUT`: `qtySets -= body.qtySets` (reject if this would go negative — return `400`)
4. Insert the `Transaction` row with `userId` from the authenticated session, `createdAt = now()`.
5. Both the Stock update and Transaction insert must succeed or fail together (single DB transaction, not two separate writes).

Response: `{ transaction: {...}, updatedStock: {...} }`
Errors: `400` for any quantity that would go negative; `404` if Bundle/Location doesn't exist.

### `GET /api/transactions` 🔒 (see below for the Transfers pair)
Query params: `?bundleId=`, `?locationId=`, `?userId=`, `?from=`, `?to=` — for audit/history views.
Response: `[{ id, type, qtySets, note, createdAt, userId, userName, bundleId, productId, productArticleNo, colorName, locationId, locationName }]` — reuses the same field names as `GET /api/stock`'s joined data for consistency. Default order: newest first.

---

## Transfers (internal movement between our own Locations)

A Transfer does **not** change total company-wide stock — it only shifts which Location holds it. It always produces exactly **two** paired `Transaction` rows (`TRANSFER_OUT` at the source, `TRANSFER_IN` at the destination), both linked back via `Transaction.transferId`, created together in one atomic DB transaction so the pair can never exist half-done (`05_BUSINESS_RULES.md` rule 93).

### `POST /api/transfers` 🔒
Body: `{ bundleId, fromLocationId, toLocationId, qtySets, note? }`

Server-side logic (all inside a single DB transaction — Transfer row, both Stock updates, and both Transaction rows all land or none do):
1. Validate `fromLocationId !== toLocationId` — reject with `400 SAME_LOCATION` (a transfer to the same location isn't a transfer, it's a data-entry mistake). The schema can't express this constraint, so it's enforced here.
2. Validate `qtySets` is a positive integer; Bundle and both Locations exist (`404` otherwise).
3. Decrement source Stock using the **same guarded-UPDATE pattern as `STOCK_OUT`** — `WHERE id = ? AND qtySets >= ?` — so the "is there enough?" check and the write are one atomic statement, not a race-prone read-then-write. Zero rows matched ⇒ `400 INSUFFICIENT_STOCK`.
4. Increment destination Stock (find-or-create — a bundle never held at that location has no Stock row yet).
5. Create the `Transfer` row, then both `Transaction` rows carrying `transferId`.

`costPriceSnapshot` is `null` on both legs, deliberately — that field records what was owed to a factory for a receipt, and an internal transfer creates no such debt. Snapshotting a cost here would double-count money in `/factories/:id/payable` that was never owed twice.

Response: `{ transfer: {...}, fromStock: { locationId, qtySets }, toStock: { locationId, qtySets } }`
Errors: `400 SAME_LOCATION`, `400 INSUFFICIENT_STOCK`, `400 VALIDATION_ERROR`, `404 BUNDLE_NOT_FOUND`, `404 LOCATION_NOT_FOUND`.

### `GET /api/transfers` 🔒
Query params: `?bundleId=`, `?fromLocationId=`, `?toLocationId=`, `?userId=`, `?from=`, `?to=`.
Response: `[{ id, bundleId, productId, productArticleNo, productName, colorId, colorName, fromLocationId, fromLocationName, toLocationId, toLocationName, qtySets, note, createdAt, userId, userName }]`. Default order: newest first.

---

## Orders (creation, basic read, and all three status transitions — a formal Bill document entity and adjustment editing are separate follow-up work)

Most endpoints here are 🔒 any-authenticated-role; `PATCH /:id/bill` is 👑 OWNER-only (rule 63). **Stock is deducted at `bill`, never at `pack`** — see those two endpoints.

Order/OrderLineItem/OrderAdjustment schema: `03_DATABASE_SCHEMA.md` §2. `costPrice` never appears anywhere in this section's responses, at any role — Orders is a selling-price-facing feature (rule 10).

### `POST /api/orders` 🔒
Body: `{ partyId, lineItems: [{ bundleId, qtySetsRequested }] }`

**Any authenticated role, deliberately** — staff creating orders during a sample visit is the primary real-world use case (rule 25), not an owner action. Every line item is fully validated (Party active, every Bundle real, every Product actually priced) before the database is touched at all — one bad line rejects the whole request with zero rows created, not a partial order.

Server-side logic:
1. Validate `partyId` and a non-empty `lineItems` array; each line needs a `bundleId` and a positive integer `qtySetsRequested` — `400 VALIDATION_ERROR` otherwise.
2. Party must exist (`404 PARTY_NOT_FOUND`) and be active (`409 PARTY_ARCHIVED`).
3. Every `bundleId` must resolve to a real Bundle (`404 BUNDLE_NOT_FOUND`).
4. Every referenced Product must have a non-null `sellingPrice` (`400 UNPRICED_PRODUCT`) — a pending-price article can't be ordered.
5. `priceAtOrder` is computed server-side from `Product.sellingPrice` at this exact moment — **never trusted from the request body**, same principle as `Transaction.costPriceSnapshot`.
6. `Order.createdById` comes from the authenticated session, never the request body. `status` defaults to `PLACED`.

Response: `{ id, partyId, partyName, status, createdById, createdByName, createdAt, packedAt, billedAt, shippedAt, lineItems: [{ id, bundleId, productId, productArticleNo, productName, colorId, colorName, qtySetsRequested, qtySetsPacked, priceAtOrder }] }`
Errors: `400 VALIDATION_ERROR`, `400 UNPRICED_PRODUCT`, `404 PARTY_NOT_FOUND`, `404 BUNDLE_NOT_FOUND`, `409 PARTY_ARCHIVED`.

### `GET /api/orders` 🔒
Query params: `?partyId=`, `?status=`, `?from=`, `?to=`.
Lightweight list — party name and a line-item summary, not full nested detail (same "line count, value" shape `07_UI_DESIGN_BRIEF.md`'s Owner Dashboard Orders widget already documents).
Response: `[{ id, partyId, partyName, status, createdAt, lineItemCount, totalValue }]`. Default order: newest first.

### `GET /api/orders/:id` 🔒
Full detail, same shape `POST` returns — every line item included, each with the article/color info needed to actually display it.
Errors: `404 ORDER_NOT_FOUND`.

### `PATCH /api/orders/:id/pack` 🔒
Body: `{ lineItems: [{ lineItemId, qtySetsPacked }] }` — exactly one entry per line on the order.

**Any authenticated role, deliberately** — staff is the primary user for this transition (rule 63), same staff-primary reasoning as `POST /api/orders`.

**Touches no stock** *(changed 2026-08-17 — packing used to perform the deduction)*. This is a pure counting/staging step: it records what was counted and nothing else. Deduction moved to `PATCH /api/orders/:id/bill` — see that endpoint and `LEARNING_LOG.md` for why.

Server-side logic:
1. Order must currently be `PLACED` (`409 ORDER_NOT_PLACED` otherwise — can't pack an already-packed/billed/shipped order).
2. Every `lineItemId` must belong to this order, and the submission must cover every line on the order exactly once (`400 VALIDATION_ERROR`).
3. `qtySetsPacked` must be an integer between `0` and that line's `qtySetsRequested` inclusive — **rejected**, not clamped, if out of range (`400 VALIDATION_ERROR`). Clamping is a UI behavior (rule 64); a server-side value outside that range means something's wrong upstream.
4. `OrderLineItem.qtySetsRequested` is never modified by packing — it stays the original ask permanently. `qtySetsPacked` is a separate field reflecting reality.
5. **No `Stock` row is read or written, and no `Transaction` is created.** A line may legitimately be packed for more than is currently on the shelf; that discrepancy surfaces at billing, which is what actually moves inventory. There is consequently no `INSUFFICIENT_STOCK` path on this endpoint at all.
6. For any line where `qtySetsPacked < qtySetsRequested`, an `OrderAdjustment` row is written (`field: "qtySetsPacked"`, `lineItemId` set, `reason: SHORT_PACKED`) — the visible history entry explaining the shortfall.
7. `Order.status` → `PACKED`, `packedAt` set to now. One more `OrderAdjustment` row is written for the status change (`field: "status"`, `oldValue: "PLACED"`, `newValue: "PACKED"`, `reason: null` — routine progress, not a correction).
8. All of the above happens atomically in one transaction.

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `400 VALIDATION_ERROR`, `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_PLACED`.

### `PATCH /api/orders/:id/bill` 👑
No body.

**OWNER only** — the one order transition that is not any-role. Rule 63 states plainly that `... → Billed` is owner-only and must never be offered to STAFF, and this is also where real inventory moves. Enforced by `requireRole('OWNER')` middleware, returning `403 FORBIDDEN_ROLE` for a STAFF caller.

**This is the stock-deduction point** *(moved here from pack, 2026-08-17)*. Billing is the commitment: it is already rule 23's hard lock (nothing about an order is editable once Billed), so a deduction placed here can only ever run once, by construction. Packing, by contrast, is a recountable step — deducting there meant a re-pack could deduct the same stock twice.

There is **no formal Bill document/invoice entity yet** — amounts, GST, and a printable document are an explicitly separate later task. This is a pure status-transition-plus-deduction endpoint, structurally the same shape as `ship`.

Server-side logic:
1. Order must currently be `PACKED` (`409 ORDER_NOT_PACKED` otherwise — can't bill an order that was never packed, or one already billed/shipped).
2. Stock is deducted per line by pulling from `Location` rows holding that Bundle, **in alphabetical order by Location name** (FIFO across locations, rule 64), until the quantity is satisfied. One `STOCK_OUT` `Transaction` is written per location actually drawn from, each linked via `orderLineItemId`.
3. Deduction is driven by each line's **`qtySetsPacked`** — what was actually counted during packing — **not** `qtySetsRequested`. A short-packed line moves only what was really packed; the shortfall was already recorded as its own `SHORT_PACKED` adjustment at pack time and gets no second entry here. Lines with `qtySetsPacked: 0` are skipped entirely.
4. If total available stock across all locations can't cover a line's `qtySetsPacked`, the whole request is rejected (`409 INSUFFICIENT_STOCK`) — no partial deduction, same everything-or-nothing atomicity as order creation. Unlike at pack time this can genuinely fire in normal use: stock may have moved between packing and billing (another order billed first, a transfer, a correction).
5. `Order.status` → `BILLED`, `billedAt` set to now. One `OrderAdjustment` row is written (`field: "status"`, `oldValue: "PACKED"`, `newValue: "BILLED"`, `reason: null` — routine progress).
6. All of the above happens atomically in one transaction.

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `403 FORBIDDEN_ROLE`, `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_PACKED`, `409 INSUFFICIENT_STOCK`.

### `PATCH /api/orders/:id/ship` 🔒
No body. **Any authenticated role, deliberately** — staff is the primary user for this transition (rule 63).

Server-side logic:
1. Order must currently be `BILLED` (`409 ORDER_NOT_BILLED` otherwise).
2. No line-item changes. `Order.status` → `SHIPPED`, `shippedAt` set to now. One `OrderAdjustment` row is written (`field: "status"`, `oldValue: "BILLED"`, `newValue: "SHIPPED"`, `reason: null` — routine progress).

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_BILLED`.

---

## General Error Conventions

- `400` — validation failure (bad input shape, would-be-negative stock, etc.)
- `401` — not authenticated
- `403` — authenticated but not authorized for this action (wrong role, missing/invalid PIN)
- `404` — resource not found
- `409` — uniqueness conflict (duplicate article+factory, duplicate product+color, duplicate color name)

All error responses: `{ error: { code, message } }` — keep messages specific enough to debug (e.g. name the conflicting field), never generic "something went wrong."
