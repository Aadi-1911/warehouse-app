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
- Setting or editing `costPrice` or `sellingPrice` — whether at creation or later — requires OWNER role AND a separate PIN match, never role alone, with no exception for it happening at creation time.
- Stock quantities (`Stock.qtySets`) only ever change as a side effect of inserting a `Transaction` row, atomically. Never write a direct UPDATE to Stock.
- Article numbers are unique per Factory, never globally — all lookups/matches must be scoped to the selected Factory.
- Order status is exactly four stages: Placed → Packed → Billed → Shipped. Don't collapse or reorder these.
- Before installing any new npm package, check its `engines` field (`npm view <package> engines`) against this machine's Node version. This has caused real problems three times already (Prisma 7, Vite 7, jsdom) — check proactively, don't wait to hit the error.

## Working style
- One task at a time, scoped to a single resource, endpoint, or screen. Don't build multiple pieces in one session.
- Explain your reasoning before writing code, especially for anything touching auth, pricing, or stock mutation logic.
- Stop after each task and wait for review — don't chain into the next task unprompted.
- If something in the docs is ambiguous or missing, ask rather than assume.
- In frontend tests, use polling (`waitFor`) for anything waiting on a real network response, never a fixed `sleep()` — a fixed delay against a real backend is inherently unreliable (too short flakes, too long wastes time). Plain `sleep()` is fine only for purely synchronous UI state changes with no network involved.
- A test that scripts the exact interaction sequence needed to use a feature (e.g., "switch the dropdown to trigger staging") proves the underlying logic works — it never proves a real person could discover that sequence without already knowing the implementation. Where a feature depends on a non-obvious interaction, the UI itself must make that interaction visibly discoverable (a visible staged-list, a counter, an explicit button) — a passing test is not a substitute for real usability.
- Any async-loading UI state must be able to represent "hasn't started fetching yet" as its own distinct state — never alias it onto whatever a loading boolean defaults to. A boolean that starts `false` is indistinguishable from "finished loading, found nothing," producing a real, deterministic window (however brief) where the UI shows a false empty-state before the fetch has even begun. Use an explicit status (`'idle' | 'loading' | 'loaded'`, or similar) for anything that fetches data on mount/lookup, not a bare boolean.
- A `waitFor` predicate must be false in the starting state, before the action being waited on happens — otherwise it can pass immediately by coincidence (already true from a previous state), silently asserting against stale data instead of actually waiting for anything. Key the wait on something that's only true in the target state, never something that merely tends to already be true.

## Git commits
- Never include AI attribution — no "Generated with Claude Code" line, no "Co-Authored-By: Claude" trailer. Commits should read like a person wrote them.
- Short, direct, imperative summary line (e.g. "Add Prisma schema for Phase 1 entities", not "This commit implements..." or a bullet list of every file touched).
- Only add a body beyond the summary line if there's a genuinely non-obvious reason behind the change worth recording — not a recap of what the diff already shows.
- Commit after each reviewed task, not just once at the start of the project.
- Push after every commit (`git push`) — don't leave commits sitting ahead of `origin` between sessions.

## Documentation maintenance (for any AI agent working on this project, Claude Code or otherwise)
- Whenever a task changes what's true about a phase's status — a screen goes from placeholder to built, a "not yet committed" note becomes committed, a documented bug gets fixed — update the relevant status line(s) in `06_ROADMAP.md` in the SAME commit as the code change. Don't defer it to a later cleanup pass; that's exactly how this doc went nine commits stale.
- Treat every claim in `06_ROADMAP.md`, `SESSION_HANDOVER.md`/`CONTEXT_HANDOVER.md` (if present), or any other continuity/handoff doc as unverified until checked against real `git log`/`git show`/`grep`/file contents. Never repeat a doc's claim into a new doc, a task summary, or a code comment without independently confirming it first — especially claims phrased as "still missing," "placeholder," "not yet committed," or "unfixed."
- If a task's own investigation surfaces a stale or wrong claim elsewhere in the docs — even one unrelated to the task at hand — flag it in the task summary rather than silently ignoring it or working around it.
- `LEARNING_LOG.md`'s Mistakes & Fixes entries are written for other AI agents and future sessions, not just Aadi — assume the reader has no memory of this conversation and needs the full story to avoid repeating the mistake.

## Comments & teaching (I'm learning full-stack dev from zero — backend AND frontend both need the same depth of explanation, nothing gets skipped because it's "just frontend" or "just styling")
- Comment **why**, not just what — applies equally everywhere: Express routes and Prisma queries get the same explanatory treatment as React components, state management, and hooks.
- `LEARNING_LOG.md` has three sections: **Decisions & Reasoning**, **Mistakes & Fixes**, and **Concepts**. Update all three continuously as things happen, not batched at the end of a task.
- **Mistakes & Fixes entries are mandatory whenever something doesn't work on the first attempt** — not just for major bugs. Every entry must cover, in order: (1) the original approach and why it seemed right at the time, (2) what actually went wrong and how it was noticed, (3) how the real cause was diagnosed, (4) the fix that was applied, and (5) **why that specific fix is the correct one** — the actual reasoning for why it addresses the real cause, not just "a" fix that happened to make the error go away.
- Concept entries must be genuinely complete, not a one-line dictionary definition: include whatever prerequisite context is needed to actually understand it (don't assume knowledge that hasn't been logged yet), how it connects to concepts already in the log, and a concrete example from this project's own code where possible — not just an abstract definition. This applies to frontend concepts (components, props, state, hooks, rendering) exactly as much as backend ones.
- After finishing a task, give a full plain-English walkthrough of what was built and why, before I review the diff — covering backend and frontend equally, assume zero prior background in either.
- If I ask "explain this like I'm new to backend dev" or "new to frontend dev," slow all the way down for that side specifically — no assumed prior knowledge.
