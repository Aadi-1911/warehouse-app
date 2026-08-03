# Wholesale Garment Business Management System

Full specs live in `/project-docs`. Read `06_ROADMAP.md` first — it indexes every other doc and defines the current build phase. **Only work within the current phase's scope unless explicitly told otherwise.**

## Doc index
- `01_PRD.md` — what to build and why
- `02_ARCHITECTURE.md` — stack, folder structure, auth design
- `03_DATABASE_SCHEMA.md` — Prisma schema (§1 = Phase 1, build now; §2 = future phases, reference only)
- `04_API_SPEC.md` — Phase 1 REST endpoints
- `05_BUSINESS_RULES.md` — ground-truth business rules, all phases
- `07_UI_DESIGN_BRIEF.md` — screen-by-screen UI spec

## Non-negotiable rules (apply regardless of which task is active)
- `cost_price` is NEVER returned to a STAFF-role request, in any API response, under any circumstance. Enforce server-side.
- Editing `costPrice` or `sellingPrice` requires OWNER role AND a separate PIN match — never role alone.
- Stock quantities (`Stock.qtySets`, `qtyReservedForSample`) only ever change as a side effect of inserting a `Transaction` row, atomically. Never write a direct UPDATE to Stock.
- Article numbers are unique per Factory, never globally — all lookups/matches must be scoped to the selected Factory.
- Order status is exactly four stages: Placed → Packed → Billed → Shipped. Don't collapse or reorder these.

## Working style
- One task at a time, scoped to a single resource, endpoint, or screen. Don't build multiple pieces in one session.
- Explain your reasoning before writing code, especially for anything touching auth, pricing, or stock mutation logic.
- Stop after each task and wait for review — don't chain into the next task unprompted.
- If something in the docs is ambiguous or missing, ask rather than assume.

## Comments & teaching (I'm learning backend dev from zero — treat every session as a lesson too)
- Comment **why**, not just what — the code itself already shows what a line does; the comment should explain the reasoning (why this approach, why this matters, what would break without it).
- `LEARNING_LOG.md` at the project root has two sections: **Decisions & Reasoning** (why we built things a particular way, what alternative we didn't take and why) and **Concepts** (plain-English glossary). Update both **continuously, not just at the end of a task** — the moment a real decision gets made or a new concept comes up, even mid-task, log it right then rather than batching it for later.
- Concept entries must be genuinely complete, not a one-line dictionary definition: include whatever prerequisite context is needed to actually understand it (don't assume knowledge that hasn't been logged yet), how it connects to concepts already in the log, and a concrete example from this project's own code where possible — not just an abstract definition.
- After finishing a task, give me a short plain-English walkthrough of what you built and why, before I review the diff — assume I have no backend background at all.
- If I ask "explain this like I'm new to backend dev," slow all the way down — no assumed prior knowledge.
