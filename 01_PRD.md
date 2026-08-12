# Product Requirements Document
## Wholesale Garment Business Management System — Phase 1 (Inventory)

**Document status:** Final for Phase 1 implementation. This is a living spec — later phases are described for context but are explicitly NOT in current build scope.
**Audience:** Any engineer or AI coding agent implementing this system. Treat every stated rule as ground truth, not a suggestion — this spec was derived from extensive stress-testing against a real operating business, not assumptions.

---

## 1. Business Context

The system is being built for a real wholesale garment business (family-run) that sources garments from factories and distributes them in bulk to retail shopowners ("Parties" — see Phase 2). It has two goals with equal weight when they don't conflict, and business need wins when they do:
1. Be a genuinely useful daily tool for a real, currently-manual business.
2. Serve as a credible, resume/interview-worthy full-stack project for the developer building it.

**Current state:** All stock tracking, order-taking, and billing is done manually — memory, notebooks, WhatsApp photos, and an Excel invoice template. There is no system of record.

**Scale:** Small. Two users at launch (owner + one staff member), room to grow to a handful of staff. New stock arrives roughly weekly to a few times a month. This is NOT a high-throughput or high-concurrency system — design accordingly (see Section 7).

---

## 2. Problem Statement (Phase 1 scope)

Ranked by dependency — each depends on the one before it being solved first:

1. **Stock in/out tracking** — no reliable log of what enters or leaves inventory.
2. **Current stock visibility** — owner/staff don't know what's in stock or what's running low without physically checking.
3. **Organizing/finding items** by article, color, size — currently unstructured.
4. **Reconciliation** (physical count vs. system count) — deferred to a later phase; depends on 1–3 being solid first.

Phase 1 solves problems 1–3. Problem 4 is Phase 4.

---

## 3. Users

| Role | Who | Device | Access |
|---|---|---|---|
| **OWNER** | Business owner (one person) | **Both PC and phone** | Full access. Only role that can ever see `cost_price`. Editing `cost_price` or `selling_price` additionally requires a PIN confirmation (see Section 9, Non-Functional Requirements). |
| **STAFF** | Warehouse/sales staff (starts at 1, may grow) | **Phone only** | Can log stock in/out. Can view `selling_price` but never `cost_price`. Cannot edit prices under any circumstance, regardless of PIN. |

Staff are not highly technical — UI must favor taps/dropdowns over free-text entry, and UI-facing labels must use plain language, not schema terminology (see Section 8, Glossary).

---

## 4. Success Criteria (Phase Gate)

Phase 1 is considered "done and adopted" — and only then does Phase 2 begin — when:

> At least one unprompted stock in/out entry (covering both a stock-in and a stock-out event) has been logged across 2 consecutive weeks, with zero reliance on the old notebook system during that window.

This is a real usage gate, not a feature-completeness gate. A feature-complete but unused system does not satisfy this criterion.

---

## 5. Functional Requirements — Phase 1 (BUILD NOW)

### 5.1 Authentication
- Login via username/password (see Architecture doc for hashing approach).
- Session persists per device (staff stay logged in on their phone; owner on their PC).

### 5.2 Factory Management
- Owner can create/view/edit Factories (name, contact info).
- Factories grow over time — no hardcoded list.

### 5.3 Product (Article) Management
- Owner can create/edit a Product: article number, Factory, category, cost price, selling price.
- Article number is unique **per Factory**, not globally (the same article number can exist under different Factories). Lookup/matching must always be scoped to the currently-selected Factory.
- Each Product has a fixed set of sizes defined once at creation, with no size pre-selected by default — staff always selects manually. Adult sizing: a Common row (M, L, XL, XXL) plus an always-visible Extended row (3XL–6XL); Small (S) is available via a "+ add other size" option rather than shown by default. A per-article "Kids" toggle switches the size vocabulary entirely to age brackets instead of letter sizes. Pieces-per-set = however many size/age options are selected, for both adult and kids articles — one unified rule.
- Sizes belong to the Product, not duplicated per color/bundle.
- `cost_price` and `sellingPrice` are nullable — a Product with either unset shows a "pending price" state everywhere it appears, until the owner sets both. Editing either requires PIN confirmation (owner only, see Section 9).

### 5.4 Color Management
- Structured Color list (not free text) — owner/staff can add new colors as needed, selected from dropdown elsewhere in the app.

### 5.5 Bundle (Set) Management
- A Bundle = a specific Product + a specific Color. This is the real sellable/trackable unit — garments are never sold or tracked as loose pieces, only as complete sets.
- Only colors that have an actual Bundle for a given Product should be selectable when working with that Product elsewhere in the app (e.g., at stock-entry time) — do not show the full global color list indiscriminately.

### 5.6 Location Management
- Owner can create/view Locations (e.g., "Delhi", "Gurgaon").

### 5.7 Stock Tracking
- Stock is tracked per Bundle **and** per Location (a given Bundle can have different quantities at different Locations).
- Quantity is counted in **sets**, never individual pieces.
- Stock also tracks a separate "reserved for sample" quantity — sets pulled out to show to a Party are not removed from inventory, they move into a reserved state and can later return to available stock (see Transaction types below).

### 5.8 Transactions (the audit trail)
- Every stock movement must create a Transaction record: who did it, what type, how much, when.
- Transaction types (Phase 1): `STOCK_IN`, `STOCK_OUT`, `SAMPLE_OUT`, `SAMPLE_RETURN`.
- **No stock quantity is ever manually edited directly** — every change to a Stock row must be the result of a logged Transaction. This is a hard rule, not a style preference.

### 5.9 Screens (Phase 1)
1. **Add Stock Entry** — the single most-used screen. Must work smoothly for non-technical staff on a phone: select Product → select Color (filtered to valid Bundles only) → select Location → enter quantity (sets) → select movement type → submit. Minimal typing, dropdowns/taps preferred.
2. **Live Stock View** — searchable/filterable dashboard by article, color, location. Shows current stock levels. Owner sees cost price context where relevant; staff do not.
3. **Manage Users** (owner-only, low-frequency use) — full scope: a list of existing accounts (name, username, role, active status), a "create new" action (Name, Username, Password, Role — with a brief description of what each role grants, and the OWNER option hidden entirely for a non-primary-owner creator), and a deactivate/reactivate toggle per account (never a hard delete — see rule 75). A newly created owner account has no PIN yet; setting it is a separate self-service action the new owner does themselves, not part of this screen. This was missing from the original screen list despite the backend supporting account creation since early in Phase 1 — added because there was no way for the owner to onboard real staff without manually crafting an API request, which blocks the actual Phase 1 usage gate.

### 5.10 Stretch (only if time allows within Phase 1, not required)
- Low-stock flag/alert: ≤2 sets remaining triggers a small red badge (never a fully-tinted card/row — keep it subtle, not alarming). This threshold is used consistently everywhere stock is shown, including future Live Stock, Pack Order, and New Order screens.

---

## 6. Functional Requirements — Future Phases (context only, NOT in current build)

Documented here so the current build's data model doesn't foreclose these later. Do not implement.

- **Phase 2 — Orders & Parties:** Party (customer) management, Order lifecycle (Placed → Packed → Billed → Shipped), live order capture during in-shop sample visits with factory-disambiguation when an article number exists under multiple factories, order change audit log, WhatsApp-photo-fallback manual entry path, Pack Order screen with dual Tally (physical-count checklist) + Pack List (grouped by article/factory/party) views, a dedicated Low Stock list view, and a History activity log (all events, timestamped, attributed to the logging user — edits create new correcting entries, never overwritten in place).
- **Phase 2.5 — Lightweight dues visibility:** an informal "outstanding amount owed" view per Party, computed directly from Order pricing, for owner convenience. Explicitly NOT the formal Bill — see Phase 3.
- **Phase 3 — Billing & Payments:** the FORMAL Bill/Invoice generation (piece-wise line items, replicating the business's existing Excel template) — genuinely undesigned in detail as of this writing, distinct from the Phase 2.5 dues tracker above. E-way bill threshold flagging (₹50,000, flag only — filing stays external/manual), Payment tracking with FIFO-default/manual-override allocation, running due balance per Party with 15/30/45-day tiers (from delivery date, varying by Party track record), post-bill clerical `BillCorrection` entity (distinct from physical defect handling).
- **Phase 4 — Polish & Edge Cases:** Defect/Return handling (minor vs. bulk, including damaged-on-arrival flagging during receiving), generic attachable Notes, toggleable Good/Great/Bad Flag per article, full stock reconciliation (physical vs. system count).

Full detail for all of these lives in `05_BUSINESS_RULES.md` and should inform Phase 1's schema design (see `03_DATABASE_SCHEMA.md`) even though they aren't built yet.

---

## 7. Non-Functional Requirements

- **Platform:** Responsive website, installable as a PWA — not a native app. See `02_ARCHITECTURE.md` for reasoning.
- **Device split:** All screens must work acceptably on mobile — large tap targets, minimal typing, one-handed usable. Owner-facing screens (pricing, corrections) can take advantage of extra desktop space when available, but must never assume desktop-only, since owner also checks the app from a phone.
- **Authorization:** All access control (role checks, PIN checks) must be enforced **server-side**. UI-level hiding alone is not acceptable — this applies especially to `cost_price` visibility and editing.
- **Auditability:** Every stock quantity must be traceable to a logged Transaction. No floating, manually-editable numbers.
- **Scale:** Design for correctness and usability, not throughput. 2–5 users, weekly-cadence usage. Do not over-engineer for concurrency, high availability, or large data volume.
- **Concurrency:** Simultaneous edits to the same record by two users is an accepted low-probability risk at this scale — last-write-wins is acceptable. No conflict-resolution UI required.
- **Connectivity:** Assume mostly-reliable mobile connectivity for staff; occasional drops are acceptable and are not the system's responsibility to solve (existing WhatsApp/photo fallback covers this in Phase 2). Do not build offline-first sync.

---

## 8. UI Language Glossary (schema term → user-facing label)

| Schema term | User-facing label |
|---|---|
| Bundle | Set |
| Stock (quantity) | Piece count / Stock level |
| Transaction | (not shown as a term — shown as an activity log/history) |
| Product / Article | Article |

Staff-facing copy should never expose raw schema/entity names.

---

## 9. Explicitly Out of Scope for Phase 1

- Party, Order, Bill, Payment, and all Phase 2/3/4 entities — schema may anticipate them (per `03_DATABASE_SCHEMA.md`) but no functionality should be built for them yet.
- Native mobile app.
- Offline-first / sync architecture.
- Multi-tenant support (this is built for one business; extensibility is a schema-level design goal only, not a feature).
- Automated GST e-way bill filing (any phase — always stays external/manual, app only flags).
- Stock transfers between Locations (accepted limitation, schema-compatible to add later if ever needed).
