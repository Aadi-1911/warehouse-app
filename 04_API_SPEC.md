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

### `PATCH /api/users/:id` 👑 — added 2026-08-21
Body: any subset of `{ name, username }`. No PIN — editing a name/username is gated by role + `isPrimaryOwner` alone, the same tier as deactivate/reactivate below, not treated as sensitive as a price edit or password reset.
**Editing a different OWNER's name/username requires `isPrimaryOwner: true`** on the requester — same restriction as `PATCH /api/users/:id/password` (rule 97): a non-primary OWNER can freely rename any STAFF account and can rename themselves, but cannot touch a different OWNER's details, including the primary owner's. Editing your own account has no special restriction, same reasoning as self-password-reset — an active session is treated as strong enough proof of who you are.
Username uniqueness is enforced by attempting the write and catching the DB's own `@unique` constraint (`409 DUPLICATE_USERNAME`) — the exact same mechanism `POST /api/users` already uses, not a separate pre-check, so the case-sensitivity behavior can't drift out of sync between creation and editing.
Response: `{ id, name, username, role, isActive, isPrimaryOwner }` — same shape as `GET /api/users`.

### `PATCH /api/users/:id/deactivate` 👑
Sets `isActive: false`. **Never hard-delete a User** — Transaction and History records reference `userId` and must stay resolvable forever, per the audit-trail principle. A deactivated user can't log in (`auth.js` must check `isActive` on every login and every token verification, not just at login time) but their historical records stay fully intact and correctly attributed.
**Two guards, both required, closing a real total-lockout risk:** (1) a user can never deactivate their own currently-logged-in account — reject with `403`. (2) deactivating the last remaining `isActive: true` OWNER-role account is rejected with `403`, regardless of primary status — the system must never be able to reach zero active owners through the API, since only a primary owner can create a new one and only an active owner can reactivate anyone.

### `PATCH /api/users/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

### `PATCH /api/users/me/pin` 🔒 (OWNER only)
Body: `{ newPin, currentPin? }`. Self-service PIN set/change — **the only way a PIN is ever set, never done by whoever created the account.** If `priceEditPinHash` is currently null (first-time setup), `currentPin` is not required. If a PIN already exists, `currentPin` must be provided and verified before the new one is accepted — same reasoning as a password change, prevents someone with just an active session from silently changing the PIN.

### `POST /api/users/me/verify-pin` 📌 (OWNER only) — added 2026-08-21
Body: `{ pin }`. Response: `200 { ok: true }`, or the standard PIN failure shape (`403` with `MISSING_PIN` / `INVALID_PIN` / `PIN_LOCKED` / `PIN_NOT_SET`, and `attemptsRemaining` alongside `INVALID_PIN`).

**The only PIN endpoint with no side effects.** Every other PIN use in this API verifies the PIN as a precondition of a real write (price edits, factory payments/debits, password resets). The Owner Dashboard's lock screen has nothing to write — the question genuinely is just "is this the owner's PIN" — so it gets its own endpoint rather than a mutating one being repurposed with a no-op payload, which would leave the audit trail claiming a write that never happened.

Verification is the `requirePin` middleware itself, unchanged: same hash comparison, same `failedPinAttempts` counter, same 5-attempt/15-minute lockout shared with every other PIN gate. A failed unlock attempt on the dashboard therefore counts toward the *same* lockout as a failed price edit — deliberately, since it's the same secret and the same brute-force surface.

**Issues no token and grants no access.** The dashboard lock it serves is a privacy gate, not a security boundary: every dashboard route and every underlying endpoint is already `requireRole('OWNER')`-gated, so STAFF can never reach that data regardless. The lock exists so a legitimately-logged-in owner can blank his own screen from a bystander; the locked/unlocked state lives only in frontend memory.

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
`totalOwed` = `SUM(STOCK_IN transactions' qtySets × piecesPerSet × costPriceSnapshot)` **plus** `SUM(FactoryDebit.amount)`, both scoped to this Factory. The `STOCK_IN` sum excludes any transaction that's been corrected away (`correctionAsOriginal: null` — see "Transaction Corrections" below) — without this, correcting a receipt would double this figure rather than fix it, since the correction's own reversal is a plain `STOCK_OUT` and never counted here by type alone. `amountPayable` = `totalOwed − SUM(FactoryPayment.amount)`, unchanged in shape. `debits` exists so a real, manually-recorded amount owed (05_BUSINESS_RULES.md rule 96) is visible the same way `payments` already is, not just folded invisibly into the `totalOwed` figure. Lightweight, same pattern as the party-facing dues tracker — not a formal ledger. **Requires no special handling for edits/deletes** — this whole response is recomputed fresh from live rows on every call (no caching layer anywhere in the chain), so an edited or deleted `FactoryPayment`/`FactoryDebit` is correctly reflected on the very next call, verified explicitly rather than assumed when PATCH/DELETE were added below. `wasEdited` is an explicit boolean a client reads directly for an "edited" indicator — **not** inferred by comparing `createdAt`/`updatedAt`, which both remain in the response as generically useful metadata but are no longer load-bearing for that signal (an earlier updatedAt-vs-createdAt-plus-60-seconds heuristic missed a real edit made within a minute of creation; see LEARNING_LOG.md).

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
Response: `[{ id, name, isActive, profitSharePercent }]`

### `POST /api/locations` 👑
Body: `{ name }`. `profitSharePercent` defaults to `100` — not settable at creation, same reasoning as every other soft-launch default in this schema; use the dedicated endpoint below to change it.

### `PATCH /api/locations/:id/deactivate` 👑
Sets `isActive: false`. **Never hard-delete a Location** — Stock/Transaction rows reference `locationId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Owner-only — matches `POST /api/locations`' own gating, unlike Factory/Color/Product which are open to any role. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/locations/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

### `PATCH /api/locations/:id/profit-share` 👑 — added 2026-08-20 (location-attributed revenue/profit split)
Body: `{ profitSharePercent }` — integer `0`-`100`. `400 VALIDATION_ERROR` if not.

**No PIN**, deliberately — this is an admin setting on `Location`, the same class of action as deactivate/reactivate above, not a `costPrice`/`sellingPrice` edit. The non-negotiable PIN rule (CLAUDE.md) is specific to those two fields; it doesn't extend to every owner-only money-adjacent setting in the system.

What every location's stock value/revenue basis is, unchanged: cost price is identical regardless of location. Only the business's *share* of the resulting profit differs, which is why `profitSharePercent` multiplies profit (`revenue − cost`) in `utils/locationRevenue.js`, not revenue or cost individually — see that module for the full calculation.

### `GET /api/locations/revenue` 👑 — added 2026-08-20 (Owner Dashboard Locations page)
Query: `?period=month|six_months|fy|all` — required, `400 VALIDATION_ERROR` if missing or not one of these four. No `custom` From/To range on this endpoint (unlike `GET /api/parties/:id/revenue`) — the Locations page only offers the four period chips.

Response: `{ period, label, locations: [{ locationId, locationName, isActive, profitSharePercent, stockValue, revenue, profit }] }`. A thin wrapper around `utils/locationRevenue.js`'s `locationRevenueForPeriod` — no calculation logic lives in the controller. Returns **every** Location's figures in one call, not scoped to a single id: the underlying function already computes every location in one pass (one `Stock` query, one `Transaction` query), so a per-location endpoint would either waste that batching or force the frontend to refetch on every location toggle. `stockValue` is a live snapshot, unaffected by `period`; `revenue`/`profit` are scoped to the requested period.

**OWNER only, non-negotiably** — `profit` is derived from `costPrice`, which must never reach a STAFF request under any circumstance (CLAUDE.md's first rule), same reasoning as the Overview KPI's `stockValue` gating.

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
Body: `{ articleNo, name, factoryId, categoryId?, costPrice?, sellingPrice?, sizes: [{ sizeLabel, sortOrder, qty? }] }`
`qty` (added 2026-08-25, rule 102) is how many garments of that size are in one set — omit it and it defaults to `1`, which is exactly what every pre-`qty` caller already meant. When present it must be a **whole number ≥ 1**; `0` or a fraction returns `400 VALIDATION_ERROR`. A size that isn't part of the set is simply absent from the array — never sent as a `qty: 0` row, which is what keeps "has a ProductSize row" meaning exactly "is part of this set".
**Any authenticated role can create a Product with no price fields** — this lands the article in the pending-price state (rule 8), which is the normal path for staff creating new articles during Receive Stock.
**If the body includes `costPrice` or `sellingPrice`, the same rule as editing applies: OWNER role AND a PIN match are both required** (`{ pin: "<owner's PIN>" }` in the body), exactly as PATCH requires below. The distinction is never "creating vs. editing" — it's "does this request set a real price," and that's always OWNER+PIN, no exception for it happening at creation time.
`categoryId` should always be a real value from `GET /api/categories` — Receive Stock's New-article form requires picking one (Kids-toggle smart-defaults it to "Kids", but it stays changeable). It remains technically optional at the API layer only as a defensive fallback: an omitted value is silently assigned the "Others" Category rather than failing the request outright, for any caller other than the current UI (a future integration, a direct API call).
Validation: `(articleNo, factoryId)` combination must be unique — return `409` on conflict with a clear message (e.g. "Article {articleNo} already exists for this Factory"); `categoryId`, if provided, must reference a real Category — return `404 CATEGORY_NOT_FOUND` otherwise.

### `PATCH /api/products/:id` 📌
Body: any subset of editable fields — `categoryId`, `isKids`, `name`, `costPrice`, `sellingPrice`.
**If the body includes `costPrice` or `sellingPrice`:** request must also include `{ pin: "<owner's PIN>" }`. Server verifies `role == OWNER` AND PIN match against `priceEditPinHash` before applying the price change. Reject with `403` if either check fails — do not partially apply the update.
Non-price fields (`categoryId`, `isKids`, `name`) can be edited by OWNER without the PIN. `categoryId` cannot be patched to empty (it's a required field, unlike the nullable price fields) — return `400` if attempted.

**`name` (article rename, added 2026-08-28)** — an ordinary non-price attribute edit: OWNER role required (route-level, same as every other field here), **no PIN**, since rule 71's gate is specifically about money and a name carries no financial meaning. Trimmed server-side; cannot be patched to empty or whitespace-only (`400`, same required-field reasoning as `categoryId`). A rename applies to the **whole article and every colour/bundle under it** — structurally guaranteed, since `name` lives on `Product`, never per-`Bundle`; there is deliberately no per-colour rename.
`articleNo` remains permanently un-patchable (`400`) — it's the article's per-Factory identity and what historical records are keyed to reading by.
**Renaming never rewrites history:** `OrderLineItem`, `Transfer` and `PartyStockReturn` each snapshot `productNameSnapshot` at creation (see below), so records created before a rename keep displaying the name as it was at the time. Records created *before 2026-08-28* have no snapshot and fall back to the live current name — a disclosed, unbackfillable limitation, since the original name was never captured for them.

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

### `POST /api/parties` 🔒
Body: `{ name, shopName?, location?, address?, contact?, gstNo? }`
`name` required, rest optional per the schema's minimal Phase 1 Party form. **Any authenticated role as of 2026-08-18** — this was previously owner-only on the reasoning that a Party is a relationship record rather than a casual lookup list. That reasoning didn't survive contact with the actual workflow: staff meet new customers during a sales visit and need to record one on the spot to place an order, and the old gate left them blocked until an owner was free. Same staff-primary logic rule 25 already applies to `POST /api/orders`; this now matches Factory/Color/Category, which have always been open.
Validation: `name` must be unique (case-insensitive, same pattern as Color/Category/Location) — return `409` on conflict, not a generic error. **Note:** unlike Color/Factory, `Party.name` has no DB-level unique index yet, so this is an application-level check only — a real (if narrow) race window exists until a schema migration adds one.

### `PATCH /api/parties/:id/deactivate` 👑
**Still owner-only, deliberately** — creating a Party is additive and low-risk, but archiving removes an existing customer from everyone's pickers. Different blast radius, different gate.
Sets `isActive: false`. **Never hard-delete a Party** — Transaction/PartyStockReturn rows reference `partyId` and must stay resolvable forever, same audit-trail principle as `User.isActive`. Owner-only — Party has no existing creation endpoint to mirror gating from, so this was decided independently, treating a customer/shop-relationship record like Location rather than the more casual Color/Factory lookup lists. Idempotent. **No lockout-prevention guard** — no equivalent risk to Users' last-active-owner case.

### `PATCH /api/parties/:id/reactivate` 👑
Sets `isActive: true` — reverses a deactivation.

### `GET /api/parties/:id/revenue` 👑 — added 2026-08-20 (Owner Dashboard Parties page, §8, rule 98)
Query: either `period=month|six_months|fy|all`, or `period=custom&from=YYYY-MM&to=YYYY-MM`.
Response: `{ revenue, period, label }`.

**OWNER only** — matches `GET /api/dashboard/overview`'s own gating for the same underlying figure. The figure itself comes from `utils/revenue.js`'s `computeRevenue`/`periodToRange`/`revenueForPeriod` — the exact same calculation path the Overview Revenue KPI uses, just scoped to one party via the `partyId` param that module carried unused until this endpoint became its first real caller. Rule 98: only `BILLED`/`SHIPPED`, non-cancelled orders and non-cancelled line items count; month-bucketed, never a rolling day window.

`six_months` and the `custom` range are both new additions to `periodToRange` itself (not endpoint-local logic) — `six_months` is the current calendar month plus the 5 before it, expressed as one month-aligned range (equivalent to summing 6 monthly totals, since `periodToRange` already computes a single `[from, to)` pair the same way every other period does); `custom` is the From/To month picker's range, built the identical way. This keeps rule 98's "one calculation path, not five separate ones" literally true — `periodToRange` is that one path for all five period shapes.

`404 PARTY_NOT_FOUND` if `id` doesn't resolve. `400 VALIDATION_ERROR` if `period` isn't one of the four named values or `custom`, or if `custom` is missing/malformed `from`/`to`, or if `to` is before `from`.

### `GET /api/parties/:id/payable` 👑 — added 2026-08-21 (Party Payables, the mirror of Factory Payables)
Response: `{ partyId, totalBilled, totalPaid, totalReturned, amountDue, payments: [{ id, amount, date, note, createdAt, updatedAt, wasEdited }] }`

**Owner-only, PIN not required** — matches `GET /api/factories/:id/payable`'s own gating: reading a figure isn't itself a financial action, the PIN gate is reserved for the actual writes (`POST`/`PATCH`/`DELETE /api/party-payments`).

`amountDue = totalBilled − totalPaid − totalReturned`, computed fresh from live rows on every call, no caching — same principle as every other money figure in this system (rules 60, 81, 96, 98):
- `totalBilled` calls `utils/revenue.js`'s `computeRevenue(prisma, { partyId, from: null, to: null })` **directly, unmodified** — the same all-time, `BILLED`+`SHIPPED`, non-cancelled sum rule 98 already defines, not a second implementation of it. Since 2026-08-25 (rule 103) `computeRevenue` values each order at its real `actualPayable` snapshot when one exists, falling back per order to the per-piece line-item sum when it doesn't — so `totalBilled`/`amountDue` reflect what a party actually owes, discount and GST included, and one party's total may legitimately mix both sources.
- `totalPaid` = `SUM(PartyPayment.amount)` for this party.
- `totalReturned` = `SUM(qtySets × piecesPerSet × priceAtReturn)` over this party's `PartyStockReturn` rows — rule 86's corrected per-piece formula, via the shared `piecesPerSetFor` helper. This endpoint is that formula's first real caller anywhere in the codebase (no screen or endpoint had computed a return's value before it) — verified against real hand-computed numbers, not just smoke-tested, when this endpoint was built.

Unlike the Factory payable, there's no "debit" mirror here: `FactoryDebit` exists because a factory's `totalOwed` had no way to represent real pre-app debt with no `STOCK_IN` history behind it (rule 96). A Party's equivalent gap is already closed by Good Returns — `totalReturned` already plays that "reduces what's owed, with no Order behind it" role, so a second manual-adjustment entity would duplicate it rather than fill a gap.

`404 PARTY_NOT_FOUND` if `id` doesn't resolve.

### `POST /api/party-payments` 📌
Body: `{ partyId, amount, date, note?, pin }`
Records a payment made *by* a Party to the business, reducing `amountDue` — the mirror of `POST /api/factory-payments` in the reverse direction. Same `requirePin` middleware, same lockout behavior, same error codes (`403 MISSING_PIN`/`INVALID_PIN`/`PIN_LOCKED`/`PIN_NOT_SET`) as every other PIN-gated write in this API — not reimplemented here. Response includes `wasEdited: false` — always false for a freshly-created entry. `404 PARTY_NOT_FOUND` if `partyId` doesn't resolve.

### `PATCH /api/party-payments/:id` 📌
Body: any subset of `{ amount, date, note }`, plus `pin` (always required, same unconditional reasoning as `PATCH /api/factory-payments/:id` — every field here is itself a financial detail). Sets `wasEdited: true` unconditionally whenever a real edit is saved, never reset back to `false`. `404 PARTY_PAYMENT_NOT_FOUND` if the id doesn't exist.

### `DELETE /api/party-payments/:id` 📌
No body beyond `{ pin }` (always required, same unconditional gating as `PATCH` above). **A genuine hard delete** — safe specifically because nothing else in the schema references `PartyPayment` by foreign key (confirmed by inspecting `schema.prisma`: only `Party.payments PartyPayment[]`, the back-relation of `PartyPayment.partyId` itself, points at this model), same reasoning `DELETE /api/factory-payments/:id`'s own docs state explicitly rather than assume. Returns `204` with no body on success. `404 PARTY_PAYMENT_NOT_FOUND` if the id doesn't exist.

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
Response: `[{ bundleId, productId, productArticleNo, productName, productIsActive, factoryId, factoryName, colorName, locationId, locationName, qtySets }]`
**No direct write endpoint exists for Stock** — quantities only change via `POST /api/transactions` (see below). This is intentional; do not add a `PATCH /api/stock/:id`.
`factoryId`/`factoryName` added for §5.9's Factory-grouped Transfer picker — every row already traces back through a Product to exactly one Factory, so this is a same-query addition, not a new join. Existing callers unaffected.
`productName` added so both Low Stock screens can show "ArticleNo — Name" the same way Pack/Bill/Ship Order already do — another same-query addition, existing callers unaffected.
`productIsActive` added 2026-08-28 for Live Stock's archived section and Article Pricing's stock-aware archive warning. **This endpoint does not filter on it and must not start** — archiving is non-destructive for reporting (rule 85), so an archived article's real stock still has to reach every caller; the flag exists so callers can *separate* those rows, never so they can be dropped. Same-query addition, existing callers unaffected.

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

## Transaction Corrections (fixing a wrongly-recorded Receive Stock receipt) — added 2026-08-21

Corrects a `STOCK_IN` `Transaction` (a Receive Stock receipt) whose quantity, location, article/colour, and/or cost price was recorded wrong. The original `Transaction` is **never** edited or deleted (rule 9's audit-trail principle) — this creates a linked replacement instead, both visible in `GET /api/history`. Transfer corrections are a separate endpoint ("Transfer Corrections" below, added the same day as a deferred follow-up) — this endpoint only accepts `STOCK_IN`.

### `POST /api/transaction-corrections` 👑 (📌 required only if `costPrice` is included)
Body: `{ transactionId, bundleId, locationId, qtySets, reason, note?, costPrice?, pin? }`
`reason ∈ TransactionCorrectionReason { WRONG_QUANTITY, WRONG_LOCATION, WRONG_FACTORY, WRONG_PRICE, OTHER }` — `note` is required when `reason = OTHER` (same rule `GoodReturnReason.OTHER` already follows).

`bundleId`/`locationId`/`qtySets` are the **corrected, full values**, not a diff — send the original's own current values for whichever fields weren't actually wrong. `costPrice` is genuinely optional: omit it entirely (not `null`) when price wasn't the mistake, and the replacement inherits the original's own `costPriceSnapshot` unchanged rather than re-pricing against today's live `Product.costPrice` — the receipt still happened at the same real moment, only one detail was mis-recorded. Include `costPrice` and the replacement snapshots that value instead; this is the one case requiring `pin` (rule 71 applies to a `costPriceSnapshot` correction exactly as it applies to `Product.costPrice` — no exception for it happening via a correction rather than the original entry).

**WRONG_FACTORY is not a structurally distinct case.** `Transaction` has no Factory field of its own — Factory is only ever inherited via `Bundle -> Product.factoryId`. Correcting "wrong factory" and correcting "wrong article, same factory" both mean exactly one thing here: a different `bundleId`. The reason value exists purely so the audit trail records which kind of mistake it actually was.

Server-side logic (atomic — a single DB transaction):
1. Load the original `Transaction`; `404` if missing, `400 NOT_A_RECEIPT` if its `type` isn't `STOCK_IN`, `409 ALREADY_CORRECTED` if it already has a linked correction (a correction that needs correcting again re-targets the *replacement*, not the original — the chain is always linear).
2. Validate the corrected `bundleId`/`locationId` exist; `400` if the corrected values are identical to the original's (nothing to correct).
3. Reverse the original's exact stock effect: a new `STOCK_OUT` `Transaction`, same bundle/location/qtySets as the original. This throws `400 INSUFFICIENT_STOCK` if some of that wrongly-received stock has already left the building (sold, transferred, returned) — you cannot un-receive stock no longer on hand, and that rejection is correct, not a bug to route around.
4. Apply the corrected effect: a new `STOCK_IN` `Transaction` at the corrected bundle/location/qtySets, with the resolved `costPriceSnapshot` (see above).
5. Create the `TransactionCorrection` row linking `originalId -> replacementId`, with `reason`/`note`/`correctedById`.

Response: `{ id, originalId, replacementId, reason, note, createdAt }`
Errors: `404 TRANSACTION_NOT_FOUND` / `BUNDLE_NOT_FOUND` / `LOCATION_NOT_FOUND`; `400 NOT_A_RECEIPT` / `VALIDATION_ERROR` / `INSUFFICIENT_STOCK`; `409 ALREADY_CORRECTED`; the standard `403 MISSING_PIN`/`INVALID_PIN`/`PIN_LOCKED` set when `costPrice` is present.

**Effect on `GET /api/factories/:id/payable`**: that endpoint's `SUM(STOCK_IN ...)` now excludes any `Transaction` that has been corrected away (`correctionAsOriginal: null`) — without this exclusion, a correction would double the payable figure (the reversal is a plain `STOCK_OUT`, never counted there by type, so the old wrong amount would otherwise keep contributing forever, on top of whatever the corrected replacement newly contributes). A correction that changes `costPrice` therefore changes what a Factory is owed, immediately, the next time that endpoint is called — no caching to invalidate, since it's computed fresh every call already.

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

## Transfer Corrections (fixing a wrongly-recorded Transfer) — added 2026-08-21, the deferred follow-up to Transaction Corrections

Corrects a `Transfer` whose quantity, from-location, or to-location was recorded wrong. Same principle as Transaction Corrections above (the original is **never** edited or deleted, both remain visible in `GET /api/history`), different shape: two paired legs per Transfer instead of one Transaction, and no price to correct at all.

### `POST /api/transfer-corrections` 👑 — no PIN, ever
Body: `{ transferId, fromLocationId, toLocationId, qtySets, reason, note? }`
`reason ∈ TransferCorrectionReason { WRONG_QUANTITY, WRONG_FROM_LOCATION, WRONG_TO_LOCATION, OTHER }` — `note` required when `reason = OTHER`. Bundle/article is **not** correctable here — the original's `bundleId` always carries forward unchanged; this endpoint's scope is quantity and the two locations only.

`fromLocationId`/`toLocationId`/`qtySets` are the corrected, full values, same "send the original's own current values for whichever fields weren't actually wrong" convention as Transaction Corrections. No PIN branch exists — unlike a receipt, a Transfer never carries a `costPriceSnapshot` on either leg (by design, see `POST /api/transfers` above), so there is nothing price-related this endpoint could ever touch.

Server-side logic (atomic — a single DB transaction):
1. Load the original `Transfer`; `404` if missing, `409 ALREADY_CORRECTED` if it already has a linked correction (re-target the *replacement* instead, same linear-chain rule as receipts).
2. Validate the corrected locations exist and differ from each other (`400 SAME_LOCATION`, same rule `POST /api/transfers` enforces); `400` if the corrected values are identical to the original's.
3. **Reversal**: a new `Transfer`, `fromLocation`/`toLocation` swapped from the original — i.e. moving the same `qtySets` back the way it came, reusing the identical paired-`TRANSFER_OUT`/`TRANSFER_IN` mechanism `POST /api/transfers` uses. This throws `400 INSUFFICIENT_STOCK` if some of what arrived at the original's destination has already left (sold, transferred onward, returned elsewhere) — that stock can't be un-transferred, and that rejection is correct, not a bug.
4. **Replacement**: a new `Transfer` at the corrected `fromLocationId`/`toLocationId`/`qtySets`, applying exactly the way a brand-new Transfer would — independently `400 INSUFFICIENT_STOCK`-able at the corrected source.
5. Create the `TransferCorrection` row linking `originalTransferId -> reversalTransferId -> replacementTransferId`, with `reason`/`note`/`correctedById`.

Response: `{ id, originalTransferId, replacementTransferId, reason, note, createdAt }`
Errors: `404 TRANSFER_NOT_FOUND` / `LOCATION_NOT_FOUND`; `400 SAME_LOCATION` / `VALIDATION_ERROR` / `INSUFFICIENT_STOCK`; `409 ALREADY_CORRECTED`.

**Why the reversal is a real `Transfer`, not a bare pair of `Transaction` rows.** Its two legs stay typed `TRANSFER_OUT`/`TRANSFER_IN`, which keeps them automatically invisible to `GET /api/history`'s `RECEIPT` entries (those only ever look at `type: STOCK_IN`) — no extra exclusion logic needed, the same "invisible by construction" property the receipt correction's own `STOCK_OUT` reversal already had. The one exclusion this feature does need — hiding the reversal `Transfer` from the *ordinary* `TRANSFER` entries in `GET /api/history` — lives in that endpoint instead (`correctionAsReversal: null`), since a Transfer's History entry is read from the `Transfer` table directly, not filtered by `Transaction.type` the way receipts are.

---

## Orders (creation, basic read, and all three status transitions — a formal Bill document entity and adjustment editing are separate follow-up work)

Most endpoints here are 🔒 any-authenticated-role; `PATCH /:id/bill` and both cancel endpoints are 👑 OWNER-only (rule 63). **Stock is deducted at `bill`, never at `pack`** — see those two endpoints.

**Cancellation** (added 2026-08-18) is carried by `Order.isCancelled` / `OrderLineItem.isCancelled` — deliberately *not* a fifth `OrderStatus`, so the forward-only status chain is untouched. Consequences across the rest of this section:
- A **status-scoped** list (`?status=…`) excludes cancelled orders — it's a worklist. An unfiltered `GET /api/orders` still returns them, and `GET /api/orders/:id` always resolves one, so History and direct links keep working. Both responses now include `isCancelled`.
- A cancelled **order** can't be packed, billed or shipped — each of those returns `409 ORDER_CANCELLED`. Dropping off a worklist is display; these guards are the enforcement.
- A cancelled **line** is excluded from billing's stock deduction entirely, and therefore can never block billing either — cancelling a line whose stock ran short is exactly how an owner unblocks the rest of an order.
- `pack`'s full-coverage rule means every **non-cancelled** line; submitting a cancelled line returns `400`.

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

Response: `{ id, partyId, partyName, status, createdById, createdByName, createdAt, packedAt, billedAt, shippedAt, lineItems: [{ id, bundleId, productId, productArticleNo, productName, productIsKids, productSizes, colorId, colorName, qtySetsRequested, qtySetsPacked, priceAtOrder }] }`. `productIsKids`/`productSizes` (`[{ sizeLabel, qty }]`) are the `piecesPerSetFor` shape (`utils/piecesPerSet.js`) — added 2026-08-20 so a client can convert a line's sets to pieces itself (e.g. Bill Order's per-article total) without a second request. `qty` joined that shape on 2026-08-25 (rule 102): an adult article's pieces-per-set is `SUM(qty)`, so a client computing its own total needs it or it would under-count any article that repeats a size.
Errors: `400 VALIDATION_ERROR`, `400 UNPRICED_PRODUCT`, `404 PARTY_NOT_FOUND`, `404 BUNDLE_NOT_FOUND`, `409 PARTY_ARCHIVED`.

### `GET /api/orders` 🔒
Query params: `?partyId=`, `?status=`, `?from=`, `?to=`.
Lightweight list — party name and a line-item summary, not full nested detail (same "line count, value" shape `07_UI_DESIGN_BRIEF.md`'s Owner Dashboard Orders widget already documents).
Response: `[{ id, partyId, partyName, status, isCancelled, createdAt, packedAt, billedAt, shippedAt, cancelledAt, lineItemCount, totalValue }]`. Default order: newest first.
`totalValue` is the order's **real value**, not always a line-item sum (rule 103, 2026-08-25): if the order carries a rule 101 `actualPayable` snapshot, that stored discount/GST-inclusive figure is returned; otherwise it falls back to `qtySetsRequested × piecesPerSet × priceAtOrder` over non-cancelled lines, unchanged. The choice is per order, so one response legitimately mixes both. Note this can be **lower** than the pre-tax sum when a discount outweighs GST — it is not a "plus tax" figure. `isCancelled` is added (2026-08-20) so an unfiltered caller can distinguish a cancelled order from an active one at the same status — a status-scoped call (`?status=`) never returns a cancelled row to begin with (see below), so this only matters to callers reading the general, unfiltered list.

The stage timestamps are included so a status-scoped list can show the date that matters for its own stage — Bill Orders (`?status=PACKED`) shows when the order was packed, Ship Order (`?status=BILLED`) shows when it was billed. They are `null` until the order reaches that stage. `totalValue` is `SUM(qtySetsRequested × piecesPerSet × priceAtOrder)` over the order's **non-cancelled** line items (`priceAtOrder` is stored per piece, rule 69) — computed from `qtySetsRequested`, so for a short-packed order it reflects what was **ordered**, not what will actually be billed — the per-line packed quantities on the detail screen are the authoritative figure before billing. `lineItemCount` counts the same non-cancelled set, so the two figures never contradict each other on screen; an order with every line cancelled reports `lineItemCount: 0, totalValue: 0`, not an error. Corrected 2026-08-19: previously omitted the `piecesPerSet` factor, under-counting 3–6× depending on the article. Corrected again 2026-08-20: previously included cancelled lines in both fields, overstating a partially-cancelled order's total and count.

`cancelledAt` — added 2026-08-20 for the Owner Dashboard Orders page's month bucketing. Only meaningful (non-`null`) when `isCancelled`. A cancelled order's `status` can still be sitting at `PLACED` with no `packedAt`/`billedAt`/`shippedAt` at all (cancellation never rewrites `status`), so those stage timestamps can't reliably date "when this was cancelled" — instead this reads the real cancellation moment off the order-level `OrderAdjustment` row (`field: "isCancelled"`, `lineItemId: null`) that `cancelOrder`/`cancelOrderLine` already write, same append-only audit trail as every other status transition (rule 9). Falls back to the latest existing stage date, then `createdAt`, only for the (not currently reachable through the app) case of an order marked cancelled with no matching `OrderAdjustment` row.

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
Body *(added 2026-08-25, rule 101)*: `{ discountApplicable?, discountPercent?, gstApplicable?, gstPercent? }` — all optional, defaulting to no discount/no GST. `discountPercent`/`gstPercent` are plain numbers (percent, e.g. `5` for 5%), required and validated only when their own `*Applicable` flag is `true` — `discountPercent` bounded 0–100, `gstPercent` bounded 0–5. **No PIN** — gating matches billing's own existing weight exactly (OWNER-only, the existing heavy confirm modal, nothing new); this is not a cost/selling-price edit, so rule 71's PIN gate doesn't apply.

**OWNER only** — the one order transition that is not any-role. Rule 63 states plainly that `... → Billed` is owner-only and must never be offered to STAFF, and this is also where real inventory moves. Enforced by `requireRole('OWNER')` middleware, returning `403 FORBIDDEN_ROLE` for a STAFF caller.

**This is the stock-deduction point** *(moved here from pack, 2026-08-17)*. Billing is the commitment: it is already rule 23's hard lock (nothing about an order is editable once Billed), so a deduction placed here can only ever run once, by construction. Packing, by contrast, is a recountable step — deducting there meant a re-pack could deduct the same stock twice.

There is still **no formal Bill document/invoice entity** — a printable document remains explicitly separate later work. What changed 2026-08-25 is that discount/GST are now real, owner-entered facts captured at the moment of billing (rule 101) — `preTaxAmount`/`finalAmount`/`actualPayable` are computed and stored here, server-side, never trusting a client-computed final number.

Server-side logic:
1. Order must currently be `PACKED` (`409 ORDER_NOT_PACKED` otherwise — can't bill an order that was never packed, or one already billed/shipped).
2. `discountApplicable`/`gstApplicable` must be booleans if present (`400 VALIDATION_ERROR`). If `discountApplicable` is `true`, `discountPercent` must be a number between 0 and 100. If `gstApplicable` is `true`, `gstPercent` must be a number between 0 and 5 (upper bound added 2026-08-26 — this business's GST rate never exceeds 5%, so a higher value is a data-entry error rather than a valid rate). Either `*Percent` field is ignored (stored `null`) when its own `*Applicable` flag is `false`, regardless of what the client sent.
3. Stock is deducted per line by pulling from `Location` rows holding that Bundle, **in alphabetical order by Location name** (FIFO across locations, rule 64), until the quantity is satisfied. One `STOCK_OUT` `Transaction` is written per location actually drawn from, each linked via `orderLineItemId`.
4. Deduction is driven by each line's **`qtySetsPacked`** — what was actually counted during packing — **not** `qtySetsRequested`. A short-packed line moves only what was really packed; the shortfall was already recorded as its own `SHORT_PACKED` adjustment at pack time and gets no second entry here. Lines with `qtySetsPacked: 0` are skipped entirely.
5. If total available stock across all locations can't cover a line's `qtySetsPacked`, the whole request is rejected (`409 INSUFFICIENT_STOCK`) — no partial deduction, same everything-or-nothing atomicity as order creation. Unlike at pack time this can genuinely fire in normal use: stock may have moved between packing and billing (another order billed first, a transfer, a correction).

   **Every line is checked before returning, not just up to the first failure.** The response carries an `insufficientLines` array alongside `error` — `[{ lineItemId, bundleId, needed, available }]` — so a caller can show the full scope of the shortage at once rather than discovering it one line per retry. `error.message` names the single line when there's exactly one, or summarises the count when there are several.
6. `preTaxAmount` is computed as `Σ (qtySetsPacked × piecesPerSet × priceAtOrder)` across the order's non-cancelled lines — the same qtySetsPacked-based basis the deduction above already uses, not `qtySetsRequested` (rule 101). `finalAmount = discountApplicable ? preTaxAmount − (preTaxAmount × discountPercent / 100) : preTaxAmount`. `actualPayable = gstApplicable ? finalAmount + (finalAmount × gstPercent / 100) : finalAmount` — **GST is computed on `finalAmount` (post-discount), never on the original `preTaxAmount`.**
7. `Order.status` → `BILLED`, `billedAt` set to now. `discountApplicable`, `discountPercent`, `gstApplicable`, `gstPercent`, `preTaxAmount`, `finalAmount`, `actualPayable` are all written in this same update. One `OrderAdjustment` row is written (`field: "status"`, `oldValue: "PACKED"`, `newValue: "BILLED"`, `reason: null` — routine progress).
8. All of the above happens atomically in one transaction.

Response: full order, same shape as `GET /api/orders/:id` — now including `discountApplicable`/`discountPercent`/`gstApplicable`/`gstPercent`/`preTaxAmount`/`finalAmount`/`actualPayable` (all `null`/`false` for any order not yet `BILLED`).
Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN_ROLE`, `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_PACKED`, `409 INSUFFICIENT_STOCK`.

### `PATCH /api/orders/:id/lines` 👑 — added 2026-08-21
Body: `{ lineChanges?: [{ lineItemId, qtySetsRequested }], newLines?: [{ bundleId, qtySetsRequested }] }` — at least one of the two arrays must be present and non-empty. Supports changing an existing line's quantity and adding a brand-new line in the same request, since a real order edit is usually one event, not two API calls.

**OWNER only, no PIN** — closer to "modifying committed order data" than to order creation (which is deliberately any-role), matching the gating `PATCH /api/orders/:id/lines/:lineItemId/cancel` already uses.

Allowed only while the order is `PLACED` or `PACKED` (`409 ORDER_NOT_EDITABLE` otherwise, same two-status window as the cancellation endpoints below) — `Billed` on is rule 23's hard lock; a change from there would have to be a Return, not an edit. `409 ORDER_CANCELLED` if the whole order is already cancelled.

Server-side logic:
1. Each `lineChanges` entry must reference a live (non-cancelled) line on this order (`404 LINE_ITEM_NOT_FOUND` / `409 LINE_ALREADY_CANCELLED`) with a positive-integer `qtySetsRequested` that actually differs from the current value (`400 VALIDATION_ERROR` if it matches — nothing to change).
2. Each `newLines` entry's `priceAtOrder` is resolved server-side from `Product.sellingPrice` **at the moment of this request** — never trusted from the request body, same principle `POST /api/orders` already applies (`400 UNPRICED_PRODUCT` if the article has no selling price set).
3. For every changed or added line, `qtySetsPacked` resets to `0` — **only on that line**, not on every other live line on the order. A packed count against the OLD quantity is meaningless once the quantity has changed; a different line's real packed count is untouched historical data with nowhere else it's recorded. This is safe specifically because nothing in the frontend reads `qtySetsPacked` for a `PLACED` order, and the next real `PATCH /:id/pack` call fully overwrites every live line's value regardless (see `LEARNING_LOG.md` for the investigation this was based on).
4. One `OrderAdjustment` per changed line (`field: "qtySetsRequested"`, `reason: QUANTITY_CHANGED`) and per added line (`field: "qtySetsRequested"`, `oldValue: "0"`, `reason: LINE_ADDED` — a new line has no real "old" value, so "didn't exist" is recorded as "requested 0").
5. **If the order was `PACKED`, this reverts it to `PLACED`** (`packedAt` cleared to `null`) and writes one more `OrderAdjustment` (`field: "status"`, `oldValue: "PACKED"`, `newValue: "PLACED"`, `reason: ORDER_EDITED` — a logged exception, not routine progress, since it's a backward transition). Safe unconditionally: Pack no longer touches stock, so nothing can double-deduct from re-packing, and Bill re-checks real stock availability regardless of what pack last recorded. If the order was already `PLACED`, no status adjustment is written.
6. All of the above happens atomically in one transaction.

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `400 VALIDATION_ERROR`, `403 FORBIDDEN_ROLE`, `404 ORDER_NOT_FOUND`, `404 LINE_ITEM_NOT_FOUND`, `404 BUNDLE_NOT_FOUND`, `400 UNPRICED_PRODUCT`, `409 ORDER_NOT_EDITABLE`, `409 ORDER_CANCELLED`, `409 LINE_ALREADY_CANCELLED`.

### `PATCH /api/orders/:id/lines/:lineItemId/cancel` 👑
No body. **OWNER only** — cancelling voids real committed work and isn't something staff should do unilaterally.

Allowed only while the order is `PLACED` or `PACKED` (`409 ORDER_NOT_CANCELLABLE` otherwise) — from `Billed` on, rule 23's lock applies and any issue routes through a Return instead. `409 ORDER_CANCELLED` if the whole order is already cancelled; `409 LINE_ALREADY_CANCELLED` if this line is.

Sets `OrderLineItem.isCancelled = true` and writes one `OrderAdjustment` (`field: "isCancelled"`, `lineItemId` set, `reason: ORDER_CANCELLED`). **`qtySetsRequested`/`qtySetsPacked` are never rewritten** — the original ask and count stay as the historical record; only the flag changes.

Cancelling the last live line does **not** auto-cancel the order — that's a separate, deliberate action. An order with no live lines simply bills nothing.

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `403 FORBIDDEN_ROLE`, `404 ORDER_NOT_FOUND`, `404 LINE_ITEM_NOT_FOUND`, `409 ORDER_NOT_CANCELLABLE`, `409 ORDER_CANCELLED`, `409 LINE_ALREADY_CANCELLED`.

### `PATCH /api/orders/:id/cancel` 👑
No body. **OWNER only.** Same `PLACED`/`PACKED` window and the same `409` codes as the line-level endpoint.

Sets `Order.isCancelled = true` and writes one `OrderAdjustment` (`field: "isCancelled"`, `lineItemId` null, `reason: ORDER_CANCELLED`). **Line items are deliberately left untouched** — the order-level flag is what every guard and worklist reads, so stamping it onto every line too would be redundant state that could later disagree, and would erase the distinction between "one line was cancelled" and "the whole order was".

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `403 FORBIDDEN_ROLE`, `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_CANCELLABLE`, `409 ORDER_CANCELLED`.

### `PATCH /api/orders/:id/ship` 🔒
No body. **Any authenticated role, deliberately** — staff is the primary user for this transition (rule 63).

Server-side logic:
1. Order must currently be `BILLED` (`409 ORDER_NOT_BILLED` otherwise).
2. No line-item changes. `Order.status` → `SHIPPED`, `shippedAt` set to now. One `OrderAdjustment` row is written (`field: "status"`, `oldValue: "BILLED"`, `newValue: "SHIPPED"`, `reason: null` — routine progress).

Response: full order, same shape as `GET /api/orders/:id`.
Errors: `404 ORDER_NOT_FOUND`, `409 ORDER_NOT_BILLED`.

---

## Owner Dashboard 👑

### `GET /api/dashboard/overview` 👑
Query: `?revenuePeriod=month|fy|all` (default `fy`; an unrecognised value falls back to `fy` rather than erroring).

**OWNER only, and this one genuinely matters:** the response is derived from `Product.costPrice`, which CLAUDE.md forbids reaching a STAFF request under any circumstance. Note it returns the **total only**, never per-article cost — the same reasoning `GET /api/factories/:id/payable` gives for being owner-only.

Backs the Owner Desktop Dashboard's Overview KPI row (`07_UI_DESIGN_BRIEF.md` §8). Everything is computed fresh from live rows on every request — no caching, no stored aggregates, same principle as rules 60, 81, 96 and 98.

Response: `{ stockValue, setsInStock, bundlesWithStock, piecesInStock, openOrdersCount, openOrdersValue, lowStockCount, lowStockThreshold, revenue, revenuePeriod, revenueLabel }`

- `stockValue` — `SUM(qtySets × piecesPerSet × costPrice)` over every `Stock` row. Per-piece basis (rule 69's 2026-08-19 clarification), so this agrees with the factory payable about what a unit of stock is worth. A null `costPrice` (pending-price article) contributes 0 rather than being guessed at.
- `setsInStock` / `piecesInStock` — `SUM(qtySets)` and `SUM(qtySets × piecesPerSet)`. The conversion is the shared `piecesPerSetFor` helper (`utils/piecesPerSet.js`), so a Kids article counts 5/6/4 per its label, never `sizes.length`.
- `bundlesWithStock` — count of **distinct Bundles** (article+colour) holding any Stock row. Distinct bundles, not rows: one bundle stocked at three locations is one article/colour line.
- `openOrdersCount` / `openOrdersValue` — Orders at `PLACED` or `PACKED`, `isCancelled: false`; value is `SUM(qtySetsRequested × piecesPerSet × priceAtOrder)` over non-cancelled line items.
- `lowStockCount` / `lowStockThreshold` — `Stock` rows at `qtySets <= 1`, rule 56's unified threshold, counted in the database so this and Live Stock can't drift on what "low" means. The threshold is returned so the client never hard-codes it.
- `revenue` / `revenueLabel` — `SUM(qtySetsRequested × piecesPerSet × priceAtOrder)` over non-cancelled line items on non-cancelled Orders at `BILLED` or `SHIPPED` (rules 69 and 98). **Bucketed by `billedAt`** (falling back to `createdAt` only if null): billing is when the money is claimed, and it's the stable choice — shipping in a later month must not move revenue out of the month it was billed in. `month` is the whole current calendar month; `fy` is April–March (rule 98's anchor, not a rolling twelve); `all` is unbounded.

The revenue arithmetic lives in `utils/revenue.js` (`periodToRange` / `computeRevenue` / `revenueForPeriod`), separate from this controller and accepting an optional `partyId`, because rule 98 requires the Parties page's per-party sales summary to use the identical calculation — "one calculation path, not five separate ones".

---

## Good Returns (whole sets coming back from a Party) 🔒

Rule 86: a simple event log, **not** a pending/settled workflow — no lifecycle, no approval state, no partial settlement. Logging a return puts real stock back and records what it was worth. **Never touches `Party.runningDueBalance`** — reconciling the return against what's owed is a deliberate manual step.

### `POST /api/returns` 🔒
**Any authenticated role.** Taking returned goods at the counter is a staff job, the same staff-primary reasoning behind `POST /api/orders` and Receive Stock.

Body: `{ partyId, locationId, lines: [{ bundleId, qtySets, reason, note? }] }`

1. `qtySets` must be a positive **integer** — whole sets only, never partial pieces (rule 86).
2. `reason` is required on every line and must be a real `GoodReturnReason` value: `NOT_ORDERED`, `SIZE_ISSUE`, `COLOUR_NOT_ORDERED`, `COLOUR_BLEEDING`, `ACCESSORIES_ISSUE`, `OTHER`. Anything else → `400 VALIDATION_ERROR`.
3. **`note` is required when `reason` is `OTHER`** (`400 NOTE_REQUIRED`), optional otherwise. A conditional requirement the schema can't express, so it lives here — an "Other" with no explanation records nothing usable. Whitespace-only is treated as absent.
4. Party must exist (`404 PARTY_NOT_FOUND`) and be active (`409 PARTY_ARCHIVED`). Location must exist (`404 LOCATION_NOT_FOUND`). Every Bundle must be real (`404 BUNDLE_NOT_FOUND`).
5. Every Product must have a non-null `sellingPrice` (`400 UNPRICED_PRODUCT`) — an unpriced article can't be valued.
6. `priceAtReturn` is computed server-side from `Product.sellingPrice` at this exact moment — **never trusted from the request body** (a supplied value is ignored outright), and never sourced from `costPrice` (rule 10). Same principle as `priceAtOrder` and `costPriceSnapshot`.

Per line this creates one `PartyStockReturn`, **increases** real `Stock` at `locationId`, and writes one `Transaction` of type `STOCK_IN` linked via `partyStockReturnId`. The stock increase uses the same shared `applyStockMovement` helper as `POST /api/transactions` — including its find-or-create, so returning goods into a location that has never held that bundle works rather than failing on a missing `Stock` row.

**`costPriceSnapshot` is deliberately `null` on these `Transaction` rows.** That field records what was owed to a *factory* for a receipt, and `GET /api/factories/:id/payable` sums exactly these `STOCK_IN` rows. Goods coming back from a customer create no factory debt — snapshotting a cost here would inflate the payable with money never owed. Same reasoning as the Transfer legs.

**All-or-nothing.** Everything is validated and resolved before any write, so one bad line rejects the whole request with zero rows created and zero stock moved — a partial success is not a state this endpoint can return.

Response `201`: an **array**, one entry per line in submission order — `[{ id, partyId, partyName, bundleId, productId, productArticleNo, productName, colorId, colorName, locationId, locationName, qtySets, priceAtReturn, reason, note, createdAt, userId, userName }]`. Display-ready, so a client can render the result without a second round trip.

### `GET /api/returns` 🔒
**Any authenticated role.** No query params — newest first, whole list. Same response shape as above. No filtering yet, deliberately: nothing calls for one, and the honest version of "no filtering required" is not shipping a query vocabulary nobody uses. `costPrice` appears nowhere in this response at any role.

---

## History 🔒

### `GET /api/history` 🔒
No query params. **Any authenticated role may call this, but the two roles do not receive the same feed** (rule 104, added 2026-08-26). No price field of any kind (`costPrice`, `sellingPrice`, `priceAtOrder`) is selected or returned, at either role.

**Role-based visibility.** OWNER receives every entry. **STAFF receives only entries whose actor is a STAFF user** — any staff member, shared across the whole floor, never narrowed to just the caller, so two staff accounts see the same feed as each other. Entries for owner-performed actions (billing an order, correcting a receipt, an owner's own adjustment) are excluded from the response entirely — all seven source queries are restricted by actor role *before* the merge, so those rows are never sent to a STAFF request. This is a server-side restriction, not a UI convention, the same principle as `cost_price` never being selected for a STAFF request.

The scope is the **actor**, never the entry type: a `RECEIPT` entry is visible to staff when a staff member recorded it and hidden when an owner did. The two correction types are nonetheless never visible to staff in practice, because `POST /api/transaction-corrections` and `POST /api/transfer-corrections` are OWNER-gated, so every such row necessarily has an owner actor — a consequence of the actor rule, not a separate per-type rule.

Every entry carries **`actorRole`** (`"OWNER"` | `"STAFF"`) alongside `actorName`. For a STAFF caller this is always `"STAFF"` by construction. It is not sensitive: the actor's *name* is already shown on every entry, and an OWNER can already read all roles via `GET /api/users`.

**A live join to `User.role` is deliberate here, not an oversight of this project's snapshot convention.** `User.role` is write-once at account creation — there is no change-role endpoint, and `PATCH /api/users/:id` reads only `name`/`username` — and users are never hard-deleted, only deactivated, so an actor always resolves. Role-at-action-time therefore necessarily equals role-now, unlike `priceAtOrder`/`costPriceSnapshot`/rule 101's amounts, which snapshot precisely because they *are* editable later. Consequently **no backfill was needed for pre-existing entries**: the join answers correctly for every historical row already stored. If `User.role` ever becomes mutable, this basis is void and role must be snapshotted per action first.

A unified, read-only feed of what's happened across Orders, Transfers, Good Returns, Receive Stock receipts, Transaction Corrections, and Transfer Corrections, newest first. **Deliberately a read-time merge across existing tables, not a shared event-log table** — no such table exists and this endpoint doesn't create one. Every source already carries a timestamp, an actor, and enough relations to describe itself, so a denormalised second copy would be a duplicate source of truth to keep in sync for no gain (same reasoning applied to the Factory payable figure and the party dues tracker).

Seven sources are merged (each restricted by actor role for a STAFF caller, per the visibility rule above):
1. **Order creation** — one entry per `Order`, from `Order.createdAt`/`createdBy`, with party name and line count. No `OrderAdjustment` row exists for creation itself, so this comes from `Order` directly.
2. **`OrderAdjustment` rows** — every one, across every order: status transitions, quantity changes, short-packs. Article/colour is named whenever `lineItemId` is set.
3. **Transfers** — one entry per `Transfer` row. Read from the `Transfer` table directly, **not** reconstructed from the paired `TRANSFER_OUT`/`TRANSFER_IN` `Transaction` rows: those are that row's stock-movement side effects (linked back via `Transaction.transferId`), not the event. One transfer = one entry, never two. **Excludes reversal Transfers** created by a Transfer Correction (`correctionAsReversal: null`) — those are pure bookkeeping, never a real business event a person asked for.
4. **Good Returns** — one entry per `PartyStockReturn` row, same choice and same reason as Transfers: the paired `STOCK_IN` `Transaction` is the side effect (linked via `Transaction.partyStockReturnId`), not the event. `priceAtReturn` is not selected — nothing forbids it (it's a selling price), a history feed just has no use for it, the same call already made for `priceAtOrder`.
5. **Receive Stock receipts** — one entry per `STOCK_IN` `Transaction`. Added 2026-08-21 alongside Transaction Corrections — before that, this feed had no receiving source at all. A receipt needed a place here for two reasons: it's a real warehouse event same as the others, and it's the only place an OWNER can find a specific receipt to correct (the correction action lives on `dashboard/History.jsx`, so what it corrects has to be visible there too).
6. **Transaction Corrections** — one entry per `TransactionCorrection` row, describing what changed (quantity/location/article/"cost price updated" — never the actual price numbers, see below) and the reason. The original receipt's own entry (#5) is untouched; the correction is a second, separate, linked entry, same "never edit in place" principle every other correction in this app already follows.
7. **Transfer Corrections** — one entry per `TransferCorrection` row, describing what changed (quantity/from-location/to-location) and the reason. Same "original untouched, correction is a second linked entry" principle as #6, no price concern at all since a Transfer never carries one.

Response: `[{ id, type, label, timestamp, actorName, actorRole, partyName, description, ... }]`, sorted newest-first with `id` as a deterministic tiebreak (several events can share a timestamp — billing writes its stock transactions and its status adjustment in one database transaction — and without a tiebreak the order could differ between two identical requests).

- `type` is one of `ORDER_PLACED` / `ORDER_STATUS` / `ORDER_ADJUSTMENT` / `TRANSFER` / `GOOD_RETURN` / `RECEIPT` / `RECEIPT_CORRECTION` / `TRANSFER_CORRECTION`, used by the client only to pick the tag's **colour**.
- `label` is the tag's **text**: `"Placed"`, `"Packed"`, `"Billed"`, `"Shipped"`, `"Change"`, `"Cancelled"`, `"Transfer"`, `"Return"`, `"Received"`, or `"Corrected"` (shared by both correction types). Computed server-side, not derived from `type` by the client — one `type` (`ORDER_STATUS`) covers three genuinely different moments, so a per-type mapping could only render a single generic word for all of them. For `ORDER_STATUS` the label is derived from the same `OrderAdjustment.newValue` the description is built from, so the tag and the sentence can never disagree or miss a value if `OrderStatus` gains a stage.
- `description` is the human-readable line, built server-side (e.g. `"Ashiyana order placed — 5 lines"`, `"Ashiyana: order packed"`, `"40 sets of 6044 Blue transferred Delhi → Gurgaon"`, `"SAI returned 3 sets of 6002 Wine into Delhi — Colour bleeding"`, `"5 sets of 6023 Beige received at Gurgaon"`, `"Receipt corrected — 5 → 3 sets, cost price updated (Wrong quantity)"`, `"Transfer corrected — from Delhi → Gurgaon (Wrong from-location)"`). Clients render this verbatim, so a new event type added server-side displays correctly without a frontend change.
- `partyName` is `null` for transfers, receipts, and corrections — Good Returns always carry one.
- `id` is prefixed by type (e.g. `TRANSFER:<cuid>`) to guarantee uniqueness across the merged sources.
- **`RECEIPT` entries only** additionally carry `transactionId`, `corrected` (boolean), `qtySets`, `bundleId`, `locationId`, `articleNo`, `colorName`, `locationName` — read by `dashboard/History.jsx`'s OWNER-only Correct action to know which transaction to target and to pre-fill the correction form. Any role can read these fields (IDs/quantities/names, never price); the correction *action* is what's actually gated (see `POST /api/transaction-corrections` above).
- **`TRANSFER` entries only** additionally carry `transferId`, `corrected` (boolean), `qtySets`, `bundleId`, `articleNo`, `colorName`, `fromLocationId`, `toLocationId`, `fromLocationName`, `toLocationName` — same purpose as `RECEIPT`'s extra fields, for `POST /api/transfer-corrections`'s form. `bundleId`/`articleNo`/`colorName` are read-only display context here (not editable — a Transfer correction never changes the article).
- `costPrice`/`costPriceSnapshot` is **never** in this response, for any entry type, at any role — including `RECEIPT_CORRECTION`, where price is compared server-side only to decide whether to say "cost price updated" in the description. This is the same "select it, use it internally, never forward it" discipline `POST /api/transactions` already applies when snapshotting `costPriceSnapshot` in the first place. `TRANSFER_CORRECTION` has no equivalent concern — a Transfer never carries a price.

**No pagination or filtering in this first version** — the whole feed is returned. At this business's real volume that's a non-issue (currently well under 100 entries). The trade-off worth knowing: because the sort happens in application memory across seven queries, this can't be paginated efficiently at the database layer; if that ever mattered, the fix is per-source pagination with a merge cursor, still not a shared table.

---

## General Error Conventions

- `400` — validation failure (bad input shape, would-be-negative stock, etc.)
- `401` — not authenticated
- `403` — authenticated but not authorized for this action (wrong role, missing/invalid PIN)
- `404` — resource not found
- `409` — uniqueness conflict (duplicate article+factory, duplicate product+color, duplicate color name)

All error responses: `{ error: { code, message } }` — keep messages specific enough to debug (e.g. name the conflicting field), never generic "something went wrong."
