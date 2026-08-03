# Wholesale Garment Business Management System

Full specs are the numbered `.md` files in this same folder. Read `06_ROADMAP.md` first — it indexes every other doc and defines the current build phase. **Only work within the current phase's scope unless explicitly told otherwise.**

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

## Git commits
- Never include AI attribution — no "Generated with Claude Code" line, no "Co-Authored-By: Claude" trailer. Commits should read like a person wrote them.
- Short, direct, imperative summary line (e.g. "Add Prisma schema for Phase 1 entities", not "This commit implements..." or a bullet list of every file touched).
- Only add a body beyond the summary line if there's a genuinely non-obvious reason behind the change worth recording — not a recap of what the diff already shows.
- Commit after each reviewed task, not just once at the start of the project.

## Comments & teaching (I'm learning full-stack dev from zero — backend AND frontend both need the same depth of explanation, nothing gets skipped because it's "just frontend" or "just styling")
- Comment **why**, not just what — applies equally everywhere: Express routes and Prisma queries get the same explanatory treatment as React components, state management, and hooks.
- `LEARNING_LOG.md` has three sections: **Decisions & Reasoning**, **Mistakes & Fixes**, and **Concepts**. Update all three continuously as things happen, not batched at the end of a task.
- **Mistakes & Fixes entries are mandatory whenever something doesn't work on the first attempt** — not just for major bugs. Every entry must cover, in order: (1) the original approach and why it seemed right at the time, (2) what actually went wrong and how it was noticed, (3) how the real cause was diagnosed, (4) the fix that was applied, and (5) **why that specific fix is the correct one** — the actual reasoning for why it addresses the real cause, not just "a" fix that happened to make the error go away.
- Concept entries must be genuinely complete, not a one-line dictionary definition: include whatever prerequisite context is needed to actually understand it (don't assume knowledge that hasn't been logged yet), how it connects to concepts already in the log, and a concrete example from this project's own code where possible — not just an abstract definition. This applies to frontend concepts (components, props, state, hooks, rendering) exactly as much as backend ones.
- After finishing a task, give a full plain-English walkthrough of what was built and why, before I review the diff — covering backend and frontend equally, assume zero prior background in either.
- If I ask "explain this like I'm new to backend dev" or "new to frontend dev," slow all the way down for that side specifically — no assumed prior knowledge.
