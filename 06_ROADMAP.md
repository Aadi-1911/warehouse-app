# Build Roadmap
## Wholesale Garment Business Management System

**Governing principle:** Don't start a phase's entities until the previous phase is in **daily real use** by the owner and staff — not just demoed. Real usage is both the best debugging tool and the strongest evidence of success. See `01_PRD.md` Section 4 for the exact phase-gate criterion.

**On time estimates below:** these are honest, relative estimates calibrated against how Phase 1 actually went — not calendar-day promises. Phase 1 took roughly 40–50 individually reviewed tasks (backend and frontend combined) across several weeks of part-time work, with real learning curve built into that pace. Later phases should move faster per-task — the docs are now fully designed *before* building starts (a lot of Phase 1's time went into catching doc gaps mid-build, which shouldn't repeat), and established patterns (shared confirm modals, snapshot-at-transaction pricing, the review rhythm itself) now exist to reuse rather than invent. Treat these as "roughly this much work relative to Phase 1," not fixed deadlines.

---

## Phase 1 — Inventory — ✅ COMPLETE

**Goal:** Owner and staff know what stock exists and where, replacing memory/notebooks entirely.

- **Entities:** User, Factory, Product, ProductSize, Color, Bundle, Location, Stock, Transaction — all built, migrated, tested.
- **Screens:** Login, Home, Receive Stock (full: lookup, both Matched/New-article branches, sizing, Kids toggle, multi-color staging, damage flagging, receipt table, save with partial-failure handling), Live Stock View (factory-grouped, searchable, low-stock flagged) — all built, tested, and hand-verified by you in a real browser.
- **Backend:** every endpoint in `04_API_SPEC.md`'s Phase 1 section, automated-tested and manually walked through against the real Neon database.
- **What's left before this phase is truly "done" per the PRD's own gate:** deployment (nothing has left your laptop yet), then two consecutive weeks of real daily use by your dad and staff, replacing the notebook entirely.

## Phase 1.5 — Account & Payables Infrastructure (added mid-Phase-1, partially built)

**Goal:** Small, necessary operational pieces that don't fit neatly under "inventory" but are needed before real multi-person use.

- **Manage Users** — ✅ COMPLETE. Multi-owner support (self-service PIN, primary-owner-only owner creation, soft-deactivate with lockout protection), account creation/list/deactivate UI, self-service PIN setup. Since marked complete, also gained OWNER+PIN-gated admin password reset and tap-to-expand row actions — no scope change, just later additions.
- **Factory Payables** — ✅ COMPLETE. Backend (schema, `costPriceSnapshot`, `/payable`, `POST /api/factory-payments`, tested including a Kids piece-count case) **and frontend** (own screen, PIN-gated payment recording, routed from Home, OWNER-only) are both built. Also includes **FactoryDebit** (recording amounts owed to a Factory) on the same screen, with edit/delete for both Payments and Debits.
- **Article Pricing** — ✅ COMPLETE, previously missing from this roadmap entirely. Dedicated screen (`07_UI_DESIGN_BRIEF.md` §5.10) for editing `costPrice`/`sellingPrice` on existing Products, OWNER+PIN-gated per rule 71/11, plus archive/reactivate for whole articles.
- **Category** — ✅ COMPLETE, backend and frontend. Backend archive/reactivate closes the rule 85 gap this doc previously flagged as missing. Frontend archive/reactivate — a toggle behind Receive Stock's category picker — shipped in `98b3d25` ("Add archive/reactivate for Category to Receive Stock's category picker"). *(This line previously read "built but not yet committed" — that stopped being true once that commit landed and was never updated here; corrected 2026-08-31.)* The original Receive Stock picker + inline "+ create new" has been complete and committed since Phase 1.
- **Party** — ✅ COMPLETE, backend **and** frontend. `POST`/`GET /api/parties` plus deactivate/reactivate, and a real Manage Parties screen linked from Home's More list. *(This line previously read "🔲 No frontend at all" — that stopped being true some tasks ago and was never updated here; corrected 2026-08-18.)* As of 2026-08-18 the screen and `POST` are open to **any role**, with archive/reactivate still OWNER-only.
- **Good Returns** (`PartyStockReturn`) — ✅ COMPLETE. Schema finalized in `e36e87c` (`priceAtReturn` as a per-set selling-price snapshot, required `GoodReturnReason`), then `POST`/`GET /api/returns` and a Good Returns screen (party picker, location picker, article → colour chips → per-colour stepper → reason/note, staged list). Any role. Appears in History as a fourth merged source. Rule 86's "never touches `Party.runningDueBalance`" is honoured — reconciliation stays manual by design.
- **Transfer** — ✅ COMPLETE, backend (`POST`/`GET /api/transfers`, atomic paired legs, negative-stock guard) **and** frontend (own Home tile, Stock-row-based selection, no "+ create" by design). Confirms and closes what was originally rule 46's accepted Phase 1 limitation.
- **Custom-composition orders / `LoosePieces` / `TransactionSizeBreakdown`** — Schema designed and migrated. **🔲 No endpoints, no screen. Confirmed structurally dependent on Phase 2's Pack Order screen** (rule 95) — the decision of whether to substitute happens at packing time, not order time, so this can't be built until Order/Pack Order exists.

## Phase 2 — Orders & Parties

**Goal:** Reliably capture what Parties order, replacing the WhatsApp-photo workaround.

- **Entities:** Party (now includes `address`, confirmed `contact` = phone, per rule 83), Order (4-stage: Placed → Packed → Billed → Shipped), OrderLineItem, OrderAdjustment.
- **Screens:** New Order (factory-disambiguation built into the design), Pack Order (Pack List view; the originally-planned Tally view is **DROPPED**, not deferred — the checklist-first Pack Order redesign's tap-to-confirm, strike-it-off flow already gives the same at-a-glance progress Tally was meant to provide, so a second view would be redundant, not a gap), Low Stock list, History activity log, Owner Desktop Dashboard (§8 of the UI brief).
- **Owner Desktop Dashboard status:** ✅ far beyond the shell-and-Overview state this line described as of 2026-08-19. OWNER-gated `/dashboard`, header, and the six-KPI Overview (`GET /api/dashboard/overview`) plus its recent-activity feed (`GET /api/history`, unchanged) are all still there as originally built. **Orders** (`889e453` onward), **Low stock** (`9342968`), **Parties** (`4cd6e23`), and **History** (`3c2f040`) are each fully built and committed, real multi-hundred-line screens, not placeholders. A dashboard-wide **PIN lock** also shipped (`e31c80e`) — a privacy gate over the whole `/dashboard` shell (entry gate, idle auto-relock, manual lock button; see `DashboardLayout.jsx`'s own comment for why it's a privacy gate, not a second security boundary), not the per-task "owner PIN-gate dialog" this line originally described as belonging to the Orders task. The rail has also grown from its original five items to nine: **Locations** (`e31c80e`), **Article Pricing** (`9e0ba65`), **Factory Payables** (`a08dfd4`), and **Bills** (`c157f3e`) are all real, committed dashboard pages beyond the original brief. *(This line previously described four pages as "named placeholders" as of 2026-08-19 — that stopped being true across a long series of follow-up tasks and was never updated here; corrected 2026-08-31.)* Still genuinely absent, confirmed by reading `Overview.jsx`'s own comment: the design's three "extras" widgets (top parties, stock value by location, low-stock preview), and a New Order dialog/order drawer on the dashboard itself — New Order still lives only on mobile.
- **Feature:** Live order capture during in-shop sample visits, plus the manual "Log Order from Photo" fallback.
- **Note carried over from the original plan, still true:** this phase carries more real complexity than it looks like on paper — order status handling and constant mid-order adjustments are harder than anything in Phase 1.
- **Estimate:** roughly comparable in raw size to Phase 1 (similar entity/screen count), but should move faster per-task given the reasons above — realistically still the single largest remaining phase.
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 2 block), `05_BUSINESS_RULES.md` rules 17–26, 49–59.

## Phase 2.5 — Lightweight Dues Visibility

**Goal:** Owner sees outstanding amounts per Party without waiting for formal billing to exist.

- Computed directly from `OrderLineItem` pricing — no new entities beyond what Phase 2 already has.
- Explicitly NOT the formal Bill (see Phase 3).
- **Estimate:** small, a natural tail-end addition once Phase 2's Order entities exist — 2–3 tasks.
- **Full spec:** `05_BUSINESS_RULES.md` rule 60.

## Phase 3 — Formal Billing & Payments

**Goal:** Replace the Excel bill process with a real, immutable invoice; know who owes what and since when with full rigor.

- **Entities:** Bill, BillLineItem, Payment, BillCorrection.
- **Note:** genuinely undesigned in detail as of this writing — needs its own real design pass (matching the existing Excel template's exact structure, GST handling) before implementation even starts.
- **Explicitly out of scope even here:** automated e-way bill filing (flag only, human files manually).
- **Estimate:** the design pass itself is real, non-trivial work before any building begins — expect this phase to feel closer to Phase 2's scale than a quick addition, precisely because so little of it is pre-decided yet.
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 3 block), `05_BUSINESS_RULES.md` rules 27–38, 61.

## Phase 4 — Polish & Edge Cases (optional/stretch)

**Goal:** Handle the remaining real-world edge cases — valuable, but not blocking daily usefulness.

- **Entities/Features:** Defect/Return handling, generic Note, toggleable Flag, full stock reconciliation.
- **Estimate:** smaller than Phase 2/3, and genuinely optional — good candidate to build only the pieces that turn out to matter once Phases 1–3 are in real use, rather than all of it upfront.
- **Full spec:** `03_DATABASE_SCHEMA.md` §2 (Phase 4 block), `05_BUSINESS_RULES.md` rules 39–44.

---

## Document Index

| Doc | Purpose |
|---|---|
| `01_PRD.md` | What to build and why — business context, users, functional/non-functional requirements |
| `02_ARCHITECTURE.md` | Tech stack, folder structure, auth design, deployment topology |
| `03_DATABASE_SCHEMA.md` | Full Prisma schema — Phase 1 built, Phases 1.5–4 documented for context |
| `04_API_SPEC.md` | REST endpoint spec — Phase 1 fully built, Phase 1.5 designed |
| `05_BUSINESS_RULES.md` | Consolidated ground-truth business rules, all phases, organized by domain |
| `06_ROADMAP.md` | This document — phase sequencing, gating, and honest time estimates |
| `07_UI_DESIGN_BRIEF.md` | Screen-by-screen UI spec, all phases including the Owner Desktop Dashboard |
| `CLAUDE.md` | Claude Code's persistent project memory (repo root) |
| `LEARNING_LOG.md` | Decision reasoning, mistakes & fixes, concept glossary (repo root) |
| `TASK_PROMPT_TEMPLATE.md` | Reusable structure for writing task prompts |
