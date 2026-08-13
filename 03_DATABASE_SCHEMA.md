# Database Schema
## Wholesale Garment Business Management System

This document defines the full data model. **Section 1 (Phase 1) is what to implement now.** Section 2 (Future Phases) is documented so Phase 1's design doesn't foreclose it, but should NOT be implemented yet.

---

## 1. Phase 1 Schema (implement now)

```prisma
// schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  OWNER
  STAFF
}

enum TransactionType {
  STOCK_IN
  STOCK_OUT
  DEFECT_RETURN
  PARTY_RETURN // whole sets returned by a Party (damage, sizing, other reason) — never partial pieces
  TRANSFER_OUT // leg of a Transfer — decreases stock at the source location
  TRANSFER_IN  // leg of a Transfer — increases stock at the destination location
}

model User {
  id                  String   @id @default(cuid())
  name                String
  username            String   @unique
  passwordHash        String
  role                Role
  priceEditPinHash    String?  // nullable = "pending PIN" state, same pattern as pending-price. Every OWNER sets their own PIN themselves, self-service, after account creation — never set by whoever created the account.
  failedPinAttempts   Int      @default(0) // rate-limiting for PIN attempts — was implemented but never backfilled into this doc until now
  pinLockedUntil      DateTime? // set when failedPinAttempts hits the lockout threshold; null = not locked
  isActive            Boolean  @default(true) // soft-deactivate only, NEVER hard-delete a User — Transaction/History rows reference userId and must stay resolvable forever. Deactivated users can't log in but their historical records stay fully intact.
  isPrimaryOwner      Boolean  @default(false) // true only for the originally-seeded owner account. Only a primary owner can create another OWNER-role account. Regular (non-primary) owners can create STAFF accounts but not further owners.
  createdAt           DateTime @default(now())

  transactions        Transaction[]
  partyStockReturns   PartyStockReturn[]
  transfers           Transfer[]
}

model Factory {
  id        String    @id @default(cuid())
  name      String    @unique
  contact   String?
  gstNo     String?
  isActive  Boolean   @default(true) // archived, not deleted — hidden from daily pickers, fully accessible when needed
  createdAt DateTime  @default(now())

  products  Product[]
  payments  FactoryPayment[]
  debits    FactoryDebit[]
}

model Product {
  id            String        @id @default(cuid())
  articleNo     String
  factoryId     String
  factory       Factory       @relation(fields: [factoryId], references: [id])
  name          String        // e.g. "Round Neck Tee", "Kurta Set" — distinct from category, added here after every UI mockup assumed it existed but the original schema never included it
  categoryId    String        // required — every article must have a category. References the growing Category list, not free text.
  category      Category      @relation(fields: [categoryId], references: [id])
  isKids        Boolean       @default(false) // switches ProductSize vocabulary to age brackets
  costPrice     Decimal?      // nullable = "pending price" until owner sets it. OWNER visibility only, enforced at API layer.
  sellingPrice  Decimal?      // nullable = "pending price". Visible to OWNER and STAFF once set.
  isActive      Boolean       @default(true) // archives the WHOLE article, all its colors together as one unit — not per-color. Hidden from daily pickers, fully accessible when needed.
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  sizes         ProductSize[]
  bundles       Bundle[]

  @@unique([articleNo, factoryId]) // article number unique per factory, not globally
}
// A Product with null costPrice/sellingPrice shows a "pending price" badge everywhere it
// appears until the owner sets both values (PIN-gated write, see 02_ARCHITECTURE.md §4.3).

model ProductSize {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  sizeLabel String   // adult: "M","L","XL","XXL","3XL"..."6XL","S" (via "+ add other size").
                      // kids (Product.isKids = true): fixed category strings per rule 50 — "1-5yr", "6-16yr", "12-18yr".
  sortOrder Int      @default(0)

  // Adult articles: pieces-per-set = the COUNT of ProductSize rows (e.g. M/L/XL/XXL = 4 rows = 4 pieces).
  // Kids articles (rule 50, supersedes an earlier unified-counting design): exactly ONE ProductSize
  // row exists (single-select category), and pieces-per-set is a FIXED lookup on that category's
  // label, NOT the row count — "1-5yr"=5pc, "6-16yr"=6pc, "12-18yr"=4pc. Counting rows for a Kids
  // article gives the wrong answer; this caused real bugs before being caught and fixed.
  // Used later (Phase 3) to convert set-quantities into piece-quantities for billing.

  @@unique([productId, sizeLabel]) // a duplicate label for the same Product would silently
  // inflate pieces-per-set (a straight COUNT of these rows) — this makes that unrepresentable
  // at the database level, not just prevented by the chip-toggle UI never offering a duplicate.
}

model Color {
  id       String  @id @default(cuid())
  name     String  @unique
  isActive Boolean @default(true) // archived, not deleted — hidden from daily pickers, fully accessible when needed

  bundles Bundle[]
}

model Category {
  // Same growing-list pattern as Color/Factory/Location — seeded with 11 starting values
  // (T-shirts, Lowers, Shirts, Coordsets, Kids, Shorts, Tracksuits, Hoodie, Jacket,
  // Sweatshirt, Others), extendable via a "+ add new category" action in the app, never
  // hardcoded or free text. Required on every Product going forward.
  //
  // "Kids" is a real, independent category, distinct from Product.isKids — isKids controls
  // sizing behavior; Category controls browsing/filtering. Turning on the Kids sizing toggle
  // during Receive Stock smart-defaults the category picker to "Kids," but doesn't lock it —
  // a kids item can still be categorized as something more specific (e.g. "Hoodie") if that's
  // the better fit. The category picker itself is always visible during article creation,
  // regardless of the Kids toggle's state.
  id       String    @id @default(cuid())
  name     String    @unique
  isActive Boolean   @default(true) // archived, not deleted — hidden from daily pickers, fully accessible when needed

  products Product[]
}

model Bundle {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  colorId   String
  color     Color    @relation(fields: [colorId], references: [id])

  stock             Stock[]
  loosePieces       LoosePieces[]
  partyStockReturns PartyStockReturn[]
  transfers         Transfer[]
  @@unique([productId, colorId]) // defines which colors are valid for a given article
}

model Location {
  id       String  @id @default(cuid())
  name     String  @unique
  isActive Boolean @default(true) // archived, not deleted — hidden from daily pickers, fully accessible when needed

  stock             Stock[]
  loosePieces       LoosePieces[]
  partyStockReturns PartyStockReturn[]
  transfersFrom     Transfer[] @relation("TransferFrom")
  transfersTo       Transfer[] @relation("TransferTo")
}

model Party {
  id                  String   @id @default(cuid())
  name                String
  shopName            String?
  location            String?
  address             String?  // full address, distinct from the general "location" (city/area) field above
  contact              String? // phone number
  gstNo               String?
  isActive            Boolean  @default(true) // archived, not deleted — hidden from daily pickers, fully accessible when needed
  createdAt           DateTime @default(now())
  // runningDueBalance and tier deliberately NOT included here — those depend on the Order/Bill
  // system (Phase 2/3), which doesn't exist yet. This is Party pulled forward in minimal form,
  // real enough for Phase 1's custom-composition orders and returns, extended later, not replaced.

  transactions      Transaction[]
  partyStockReturns PartyStockReturn[]
}

model Stock {
  id                    String   @id @default(cuid())
  bundleId              String
  bundle                Bundle   @relation(fields: [bundleId], references: [id])
  locationId            String
  location              Location @relation(fields: [locationId], references: [id])
  qtySets               Int      @default(0) // never edit directly — only via Transaction, atomic increment/decrement only

  transactions          Transaction[]

  @@unique([bundleId, locationId])
  // A `qtySets >= 0` CHECK constraint named "stock_qty_sets_non_negative" also exists on this
  // table. It CANNOT be declared here: Prisma 6.19.3 has no `@@check` attribute (verified —
  // `prisma validate` fails with P1012 "not a valid field or attribute definition"), so it lives
  // as raw SQL in migration 20260809_round11_schema_revision. Prisma's migration engine doesn't
  // model CHECK constraints at all, which is exactly why it survives: `migrate diff` neither
  // sees it nor proposes dropping it (verified after applying). The trade-off is that it's
  // invisible to anyone reading only this file — hence this comment.
}

model Transaction {
  id                   String            @id @default(cuid())
  stockId              String
  stock                Stock             @relation(fields: [stockId], references: [id])
  userId               String
  user                 User              @relation(fields: [userId], references: [id])
  type                 TransactionType
  qtySets              Int               // always counts as whole sets, even for a custom-composition order (rule: 1 set moved, regardless of actual piece breakdown)
  note                 String?
  costPriceSnapshot    Decimal?          // populated only for STOCK_IN — the Product's costPrice at the exact moment received, so a later price change never retroactively alters what was actually owed to the factory for this receipt. Same reasoning as OrderLineItem.priceAtOrder, applied to the outgoing (factory) side instead of the incoming (party) side.
  partyId              String?           // populated only when this movement is tied to a specific Party — a custom-composition order or a PartyStockReturn. Null for ordinary Receive Stock movements.
  party                Party?            @relation(fields: [partyId], references: [id])
  isCustomComposition  Boolean           @default(false) // true only when the "custom order" toggle was used — flags that a TransactionSizeBreakdown exists for this row
  sizeBreakdown        TransactionSizeBreakdown[] // populated only when isCustomComposition = true
  partyStockReturnId   String?           // populated only for type PARTY_RETURN — links back to the return event
  partyStockReturn     PartyStockReturn? @relation(fields: [partyStockReturnId], references: [id])
  transferId           String?           // populated only for TRANSFER_OUT / TRANSFER_IN — links the two paired legs of a single Transfer back to that Transfer record. Null for every other type.
  transfer             Transfer?         @relation(fields: [transferId], references: [id])
  createdAt            DateTime          @default(now())
}

model TransactionSizeBreakdown {
  // Created only for a custom-composition order (Transaction.isCustomComposition = true).
  // Records the real, manually-entered piece-by-piece makeup of a non-standard order —
  // e.g. M:1, L:1, XL:1 (a size skipped) or M:2, L:1, XL:1 (an uneven mix) — even though
  // the parent Transaction still counts as exactly 1 set for pricing/quantity purposes.
  id            String      @id @default(cuid())
  transactionId String
  transaction   Transaction @relation(fields: [transactionId], references: [id])
  sizeLabel     String      // matches ProductSize.sizeLabel vocabulary for this article
  qtyPieces     Int
}

model LoosePieces {
  // Tracks odd/loose pieces of a specific size currently sitting outside a complete set,
  // as a result of custom-composition orders. A size skipped by an order (e.g. XXL left
  // behind) increments this; a later custom order needing an extra piece of that same
  // size draws it down from here first — this is the mechanism behind sizes "cancelling
  // out" across separate custom orders over time, per real business observation.
  id         String   @id @default(cuid())
  bundleId   String
  bundle     Bundle   @relation(fields: [bundleId], references: [id])
  locationId String
  location   Location @relation(fields: [locationId], references: [id])
  sizeLabel  String
  qtyPieces  Int      @default(0)

  @@unique([bundleId, locationId, sizeLabel])
}

model Transfer {
  // Internal stock movement between the company's own locations (e.g. Delhi <-> Gurgaon).
  // Does NOT change total company-wide stock — only shifts which location holds it.
  // Always produces exactly two Transaction rows (TRANSFER_OUT at fromLocation's Stock row,
  // TRANSFER_IN at toLocation's Stock row), both linked back here via Transaction.transferId,
  // created together inside one atomic database transaction so the pair can never exist
  // half-done (e.g. stock leaving Delhi without arriving in Gurgaon on a crash/network failure).
  id             String       @id @default(cuid())
  bundleId       String
  bundle         Bundle       @relation(fields: [bundleId], references: [id])
  fromLocationId String
  fromLocation   Location     @relation("TransferFrom", fields: [fromLocationId], references: [id])
  toLocationId   String
  toLocation     Location     @relation("TransferTo", fields: [toLocationId], references: [id])
  qtySets        Int
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  note           String?
  createdAt      DateTime     @default(now())

  transactions   Transaction[]

  // fromLocationId and toLocationId must never be equal — enforce at the application layer
  // (a "transfer" to the same location isn't a transfer, it's a no-op / data entry mistake).
}

model PartyStockReturn {
  // A simple event log, NOT a pending/settled workflow — whole sets returned by a Party
  // (damage, sizing, other reason), logged after the fact. No lifecycle, no line-by-line
  // partial settlement — just "this came back, here's what and from whom."
  id            String        @id @default(cuid())
  partyId       String
  party         Party         @relation(fields: [partyId], references: [id])
  bundleId      String
  bundle        Bundle        @relation(fields: [bundleId], references: [id])
  locationId    String        // where the returned stock is being added back to
  location      Location      @relation(fields: [locationId], references: [id])
  qtySets       Int           // whole sets only, never partial pieces
  valueSnapshot Decimal       // cost-based worth of this return, computed and stored at the moment of return — shown as its own visible figure, never touches Party.runningDueBalance (reconciled manually, by design)
  note          String?
  userId        String
  user          User          @relation(fields: [userId], references: [id])
  createdAt     DateTime      @default(now())

  transactions  Transaction[]
}

model FactoryPayment {
  // Mirrors Payment (the party-facing dues tracker) but for the reverse direction — money WE pay TO a factory.
  id          String   @id @default(cuid())
  factoryId   String
  factory     Factory  @relation(fields: [factoryId], references: [id])
  amount      Decimal
  date        DateTime
  note        String?
  createdById String
  createdAt   DateTime @default(now())
  // Lightweight — exists only so an edited entry can show it was changed (frontend's "edited"
  // label), not a formal audit trail (no before/after values kept, no editor identity recorded
  // beyond createdById). Same "not a formal ledger" framing already established for this whole
  // feature (rules 81/96). @updatedAt is maintained by Prisma itself on every update — never
  // set manually.
  updatedAt   DateTime @updatedAt
  // Explicit, unambiguous "was this ever edited" flag — replaces an earlier updatedAt-vs-
  // createdAt-plus-60-seconds heuristic that missed a real edit made within a minute of
  // creation (see LEARNING_LOG.md). Set true by updateFactoryPayment the moment any edit is
  // saved, never reset back to false — a corrected entry stays marked as corrected permanently,
  // matching this feature's "not a formal ledger, but a correction is never silently invisible"
  // framing.
  wasEdited   Boolean  @default(false)
}

model FactoryDebit {
  // The mirror of FactoryPayment in the other direction — a manual increase to amount owed,
  // same shape on purpose. Exists because totalOwed was originally ONLY derived from STOCK_IN
  // transaction history, which is correct for stock received through the app but has no way to
  // represent real, pre-app debt for a factory whose receiving history was never logged here
  // (05_BUSINESS_RULES.md rule 96) — a factory in exactly that position could show a negative
  // Amount payable purely because payments existed against a totalOwed of zero.
  id          String   @id @default(cuid())
  factoryId   String
  factory     Factory  @relation(fields: [factoryId], references: [id])
  amount      Decimal
  date        DateTime
  note        String?
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  wasEdited   Boolean  @default(false)
}
// Amount payable to a Factory = SUM(STOCK_IN transactions' qtySets × piecesPerSet × costPriceSnapshot for that factory's products)
//                                + SUM(FactoryDebit.amount for that factory)
//                                − SUM(FactoryPayment.amount for that factory).
// Same lightweight, computed-not-formal pattern as the Phase 2.5 party-dues tracker — not a formal ledger/invoice system.
```

### 1.1 Hard Rules to Enforce in Application Code (not expressible in schema alone)

- `Stock.qtySets` must only ever change as a side effect of creating a `Transaction` row, inside the same database transaction (atomic). Never expose a direct "edit stock quantity" endpoint.
- `Product.costPrice` must never appear in any API response served to a `STAFF`-role user, under any circumstance.
- Editing `Product.costPrice` or `Product.sellingPrice` requires both `role == OWNER` AND a valid PIN match against `priceEditPinHash` — checked server-side on the write endpoint.
- When creating a `Bundle` reference (e.g. during a Transaction), only `Color` values that already have a `Bundle` row for that `Product` are valid — reject arbitrary Product+Color combinations at the API layer.

---

## 2. Future Phases (documented for context — NOT implemented in Phase 1)

### Phase 2 — Orders & Parties

```prisma
enum PartyTier {
  REGULAR
  ONE_OFF
}

enum OrderStatus {
  PLACED
  PACKED
  BILLED
  SHIPPED
}

model Party {
  id                  String   @id @default(cuid())
  name                String
  shopName            String?
  location            String?
  address             String?  // full address, distinct from the general "location" (city/area) field above
  contact             String?  // phone number
  gstNo               String?
  runningDueBalance   Decimal  @default(0)
  tier                PartyTier
  createdAt           DateTime @default(now())
}

model Order {
  id          String       @id @default(cuid())
  partyId     String
  status      OrderStatus  @default(PLACED)
  createdById String
  createdAt   DateTime     @default(now())
  packedAt    DateTime?    // set when status transitions to PACKED
  billedAt    DateTime?    // set when status transitions to BILLED
  shippedAt   DateTime?    // set when status transitions to SHIPPED

  lineItems   OrderLineItem[]
  adjustments OrderAdjustment[]
}
// Confirmed lifecycle: Placed → Packed → Billed → Shipped.
// Billed requires the (separate, not-yet-designed) formal Bill entity below to exist for this order.
// A lightweight "outstanding amount" view can be computed directly from OrderLineItem pricing
// for owner convenience before formal billing exists — see note at the top of the Bill model.

model OrderLineItem {
  id              String  @id @default(cuid())
  orderId         String
  bundleId        String
  qtySetsRequested Int
  priceAtOrder    Decimal
}

model OrderAdjustment {
  // Append-only log. "Adjusted" is an event layered on top of Order.status,
  // not a status value itself — Order.status stays linear (Placed → Packed → Billed → Shipped).
  id          String   @id @default(cuid())
  orderId     String
  lineItemId  String?  // nullable — which specific line changed, for multi-line orders (rule 22). Null = order-level change, not tied to one line.
  changedById String
  changedAt   DateTime @default(now())
  field       String
  oldValue    String
  newValue    String
}
```

Notes for future implementation:
- Orders can be adjusted at any point up until `Billed`, which is a hard lock.
- The WhatsApp-photo fallback needs a manual "Log Order from Photo" entry screen so no order permanently exists only as a photo.
- Color selection at order-entry time must be filtered to only colors with a valid `Bundle` for the selected `Product` (same rule as Phase 1 stock entry).

### Phase 3 — Billing & Payments

**Note on scope:** the Bill model below is the FORMAL invoice (matching the business's existing Excel template — see rule 28 in `05_BUSINESS_RULES.md`) and is genuinely not yet designed in detail. An informal "outstanding amount owed" view is a separate, lighter feature that can be computed directly from `OrderLineItem.priceAtOrder × qtySetsRequested` per Party — useful for owner visibility before formal billing exists, but it is NOT a substitute for this Bill model and carries none of its guarantees (no immutability, no GST fields, no e-way flag, no correction mechanism).

```prisma
enum PaymentAllocationType {
  FIFO
  MANUAL_OVERRIDE
}

enum DueThresholdDays {
  FIFTEEN
  THIRTY
  FORTY_FIVE
}

model Bill {
  id                String   @id @default(cuid())
  orderId           String
  partyId           String
  billNo            String   @unique
  date              DateTime
  deliveryDate      DateTime
  dueThresholdDays   DueThresholdDays // 15, 30, or 45 — enum, not a raw Int, matching every other fixed-value-set field in this doc
  gstFields          Json?    // structure TBD at implementation time
  totalAmount        Decimal
  outstandingBalance Decimal
  ewayFlag           Boolean  // locked at creation — never re-evaluated by later corrections
  createdAt          DateTime @default(now())
  // Immutable after creation — no fields on this model are ever updated directly.
  // Corrections go through BillCorrection, not edits to this record.

  lineItems   BillLineItem[]
  corrections BillCorrection[]
  payments    Payment[]
}

model BillLineItem {
  id            String  @id @default(cuid())
  billId        String
  productId     String
  qtyPieces     Int     // billed in PIECES, not sets — derived from qtySets × pieces-per-set
  pricePerPiece Decimal
  lineTotal     Decimal
}

model Payment {
  id             String                  @id @default(cuid())
  partyId        String
  billId         String?                 // nullable — unassigned payments allocate via FIFO
  amount         Decimal
  date           DateTime
  allocationType PaymentAllocationType   @default(FIFO)
  note           String?                 // MANDATORY when allocationType == MANUAL_OVERRIDE
  createdById    String
  createdAt      DateTime                @default(now())
}

model BillCorrection {
  // For genuine clerical errors (e.g. wrong price typed), NOT physical defects.
  // Does not create a Transaction — no stock moved.
  id             String   @id @default(cuid())
  billId         String
  lineItemId     String?  // nullable — supports whole-bill corrections (e.g. GST miscalc)
  fieldCorrected String
  originalValue  String
  correctedValue String
  correctedById  String
  correctedAt    DateTime @default(now())
  reason         String
}
```

Notes for future implementation:
- Bill is generated only after packing is fully complete — never before.
- Payment allocation defaults to FIFO (oldest bill first); manual override is allowed at entry time by whoever logs the payment (owner or staff — no new permission tier), and a Note is mandatory when overriding.
- `eWayFlag` is set once at Bill creation (₹50,000 threshold) and never re-evaluated by later `BillCorrection` records — it reflects what was legally declared for goods physically dispatched at that moment.
- `Bill.outstandingBalance` = original total ± corrections − payments. The original bill record itself is never mutated.

### Phase 4 — Polish & Edge Cases

```prisma
enum FlagLevel {
  GOOD
  GREAT
  BAD
}

enum DefectSeverity {
  MINOR
  BULK
}

model Note {
  // Generic, attachable to any entity — not scoped to one table.
  id         String   @id @default(cuid())
  entityType String   // e.g. "Order", "Transaction", "Bill"
  entityId   String
  text       String
  createdById String
  createdAt  DateTime @default(now())
}

model Flag {
  id         String    @id @default(cuid())
  productId  String
  level      FlagLevel
  toggledById String
  toggledAt  DateTime  @default(now())
  // Reflaggable over time — not a permanent one-time tag.
}

model DefectReturn {
  id          String          @id @default(cuid())
  billId      String?
  orderId     String?
  qty         Int
  severity    DefectSeverity
  note        String?
  createdById String
  createdAt   DateTime        @default(now())
  // BULK severity must also create a Transaction (type: DEFECT_RETURN) —
  // enforces "every stock number traces to a logged Transaction."
  // MINOR severity does not touch inventory or the original bill.
}
```
