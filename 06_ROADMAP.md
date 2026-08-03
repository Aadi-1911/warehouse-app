# Build Roadmap
## Wholesale Garment Business Management System

**Governing principle:** Don't start a phase's entities until the previous phase is in **daily real use** by the owner and staff — not just demoed. Real usage is both the best debugging tool and the strongest evidence of success. See `01_PRD.md` Section 4 for the exact phase-gate criterion.

---

## Phase 1 — Inventory (BUILD NOW)

**Goal:** Owner and staff know what stock exists and where, replacing memory/notebooks entirely.

- **Entities:** User, Factory, Product, ProductSize, Color, Bundle, Location, Stock, Transaction
- **Screens:** Add Stock Entry, Live Stock View (searchable/filterable by article, color, location)
- **Must get right even here:** server-side (not UI-only) enforcement of `cost_price` visibility and the PIN gate on price editing — this is the one place a beginner mistake has real business consequences.
- **Stretch goal only if time allows:** low-stock threshold flagging.
- **Full spec:** `01_PRD.md` §5, `03_DATABASE_SCHEMA.md` §1, `04_API_SPEC.md`.

## Phase 2 — Orders & Parties (after Phase 1 is in daily use)

**Goal:** Reliably capture what Parties order, replacing the WhatsApp-photo workaround.

- **Entities:** Party, Order (4-stage: Placed → Packed → Billed → Shipped), OrderLineItem, OrderAdjustment
- **Screens:** New Order (with factory-disambiguation when an article number spans multiple factories), Pack Order (dual Tally + Pack List views), Live Stock View (factory-grouped accordion), Low Stock list, History activity log.
- **Feature:** Live order capture during in-shop sample visits — pre-saved Parties, tap-to-add ordering, plus a manual "Log Order from Photo" fallback screen.
- **Note:** This phase carries the most real complexity despite looking smaller on paper — order status handling and constant mid-order adjustments are harder than anything in Phase 1. Budget time accordingly.
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 2 block), `05_BUSINESS_RULES.md` rules 17–26, 49–59.

## Phase 2.5 — Lightweight Dues Visibility (small, can slot in early)

**Goal:** Owner can see outstanding amounts per Party without waiting for formal billing to exist.

- Computed directly from `OrderLineItem` pricing — no new entities beyond what Phase 2 already has.
- Explicitly NOT the formal Bill (see Phase 3) — no immutability, GST fields, or e-way flag apply here.
- **Full spec:** `05_BUSINESS_RULES.md` rule 60.

## Phase 3 — Formal Billing & Payments

**Goal:** Replace the Excel bill process with a real, immutable invoice; know who owes what and since when with full rigor.

- **Entities:** Bill, BillLineItem, Payment, BillCorrection
- **Note:** genuinely undesigned in detail as of this writing — needs its own design pass (matching the existing Excel template's exact structure) before implementation, distinct from the Phase 2.5 dues tracker.
- **Explicitly out of scope even here:** automated e-way bill filing (flag only, human files manually).
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 3 block), `05_BUSINESS_RULES.md` rules 27–38, 61.

## Phase 4 — Polish & Edge Cases (optional/stretch)

**Goal:** Handle the remaining real-world edge cases — valuable, but not blocking daily usefulness.

- **Entities/Features:** Defect/Return handling, generic Note, toggleable Flag, full stock reconciliation (physical vs. system count).
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 4 block), `05_BUSINESS_RULES.md` rules 39–44.

---

## Document Index

| Doc | Purpose |
|---|---|
| `01_PRD.md` | What to build and why — business context, users, functional/non-functional requirements |
| `02_ARCHITECTURE.md` | Tech stack, folder structure, auth design, deployment topology |
| `03_DATABASE_SCHEMA.md` | Full Prisma schema — Phase 1 to implement now, Phases 2–4 documented for context |
| `04_API_SPEC.md` | REST endpoint spec for Phase 1 |
| `05_BUSINESS_RULES.md` | Consolidated ground-truth business rules, all phases, organized by domain |
| `06_ROADMAP.md` | This document — phase sequencing and gating |
