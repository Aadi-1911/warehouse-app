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
  SAMPLE_OUT
  SAMPLE_RETURN
}

model User {
  id                  String   @id @default(cuid())
  name                String
  username            String   @unique
  passwordHash        String
  role                Role
  priceEditPinHash    String?  // only ever set for the OWNER account
  createdAt           DateTime @default(now())

  transactions        Transaction[]
}

model Factory {
  id        String    @id @default(cuid())
  name      String
  contact   String?
  createdAt DateTime  @default(now())

  products  Product[]
}

model Product {
  id            String        @id @default(cuid())
  articleNo     String
  factoryId     String
  factory       Factory       @relation(fields: [factoryId], references: [id])
  category      String?
  isKids        Boolean       @default(false) // switches ProductSize vocabulary to age brackets
  costPrice     Decimal?      // nullable = "pending price" until owner sets it. OWNER visibility only, enforced at API layer.
  sellingPrice  Decimal?      // nullable = "pending price". Visible to OWNER and STAFF once set.
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
                      // kids (Product.isKids = true): age-bracket strings, e.g. "3-5 yrs" — same field, different vocabulary.
  sortOrder Int      @default(0)

  // Number of ProductSize rows for a Product = pieces-per-set for that article, whether
  // adult letter-sizes or kids age-brackets — one unified rule, no separate 4pc/6pc lookup.
  // Used later (Phase 3) to convert set-quantities into piece-quantities for billing.
}

model Color {
  id   String @id @default(cuid())
  name String @unique

  bundles Bundle[]
}

model Bundle {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  colorId   String
  color     Color    @relation(fields: [colorId], references: [id])

  stock     Stock[]

  @@unique([productId, colorId]) // defines which colors are valid for a given article
}

model Location {
  id   String @id @default(cuid())
  name String @unique

  stock Stock[]
}

model Stock {
  id                    String   @id @default(cuid())
  bundleId              String
  bundle                Bundle   @relation(fields: [bundleId], references: [id])
  locationId            String
  location              Location @relation(fields: [locationId], references: [id])
  qtySets               Int      @default(0) // never edit directly — only via Transaction
  qtyReservedForSample  Int      @default(0) // never edit directly — only via Transaction

  transactions          Transaction[]

  @@unique([bundleId, locationId])
}

model Transaction {
  id        String            @id @default(cuid())
  stockId   String
  stock     Stock             @relation(fields: [stockId], references: [id])
  userId    String
  user      User              @relation(fields: [userId], references: [id])
  type      TransactionType
  qtySets   Int
  note      String?
  createdAt DateTime          @default(now())
}
```

### 1.1 Hard Rules to Enforce in Application Code (not expressible in schema alone)

- `Stock.qtySets` and `Stock.qtyReservedForSample` must only ever change as a side effect of creating a `Transaction` row, inside the same database transaction (atomic). Never expose a direct "edit stock quantity" endpoint.
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
  contact             String?
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
  // not a status value itself — Order.status stays linear (Placed → Packed → Billed).
  id          String   @id @default(cuid())
  orderId     String
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

model Bill {
  id                String   @id @default(cuid())
  orderId           String
  partyId           String
  billNo            String   @unique
  date              DateTime
  deliveryDate      DateTime
  dueThresholdDays   Int      // 15, 30, or 45
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
