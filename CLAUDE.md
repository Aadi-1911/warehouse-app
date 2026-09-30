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
- After any task that changes code, schema, or live data — including manual/SQL actions run outside the app itself — update the relevant doc(s) before considering the task done: `LEARNING_LOG.md` (Decisions & Reasoning or Mistakes & Fixes, as applicable), `06_ROADMAP.md` if a feature's status changed, and `CLAUDE.md` itself if a project convention changed. This applies every time, not only when a task obviously calls for it — the existing same-commit and continuous-update rules already say this; this line exists because they've been missed anyway.

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
- Claude Code never pushes; the owner pushes from his own terminal. (Pushing main deploys Production.)

## Working rules
- Paste tool output verbatim in the FINAL message; never reconstruct or summarise it; never write "pasted above".
- One command per Bash call; no && or ; chaining.
- Before running backend tests: check port 3002 is free (lsof -i :3002), start a fresh `npm run start:test`, confirm it's Running. A server started before a backend change runs old code.
- The seed script (backend/scripts/seed-handson.mjs) calls the API: the test server must be running first.
- backend/.env holds TEST_DATABASE_URL (TEST, ep-round-wind); test files load it via dotenv.
- In the VS Code terminal, never redirect a `{ ...; } > file` group (hidden ]633 markers get written into the file); use `bash -c "..." > file`.
- Neon URLs contain `&`: read them with `read -rs VAR`, never paste them inline unquoted.

## Running the backend against the TEST database
- `backend/src/server.js` checks `NODE_ENV`, not any flag: when it's `test`, the server requires `TEST_DATABASE_URL` to be set and overwrites `process.env.DATABASE_URL` with it before any controller is `require`d — every controller builds its own `PrismaClient` at require-time reading `DATABASE_URL`, so this is what actually redirects all of them. If `NODE_ENV=test` is set but `TEST_DATABASE_URL` is not, the server throws immediately rather than silently falling back to `DATABASE_URL` (the real dev database).
- Exact command: `TEST_DATABASE_URL=<value> NODE_ENV=test PORT=3002 node src/server.js`. `backend/package.json`'s `start:test` script (`npm run start:test`) runs the same thing and reads `TEST_DATABASE_URL` from `backend/.env` automatically — use the raw command instead when you need to pass the value explicitly (a fresh shell with no `.env` loaded, a one-off different test branch).
- Safe to background with a plain `&`. Do **not** background `nodemon` (or `npm run dev`, which wraps it) the same way — nodemon can raise `SIGTTIN` when backgrounded without a controlling terminal, because it tries to read stdin for its own restart commands (`rs`). A plain `node` process reads no stdin and has no such risk.
- Always confirm the server actually came up with `lsof -i :3002` (or `lsof -ti:3002` for just the PID) — never trust a clean shell return alone. A background launch can return immediately while the process is still starting, has already crashed, or — this has happened in this codebase — is an orphaned process from an earlier session already holding the port, in which case your request never reaches the code you just edited. See `LEARNING_LOG.md`'s several "stale/orphaned dev server" Mistakes & Fixes entries for the concrete failure shape.
- The `TEST_DATABASE_URL` connection string comes from **Neon Console → the `test` branch → Roles/Connect**. Never hardcode it, and never commit it anywhere — it belongs only in `backend/.env` (gitignored) or passed inline on the command line for that one shell session.

## Documentation maintenance (for any AI agent working on this project, Claude Code or otherwise)
- Whenever a task changes what's true about a phase's status — a screen goes from placeholder to built, a "not yet committed" note becomes committed, a documented bug gets fixed — update the relevant status line(s) in `06_ROADMAP.md` in the SAME commit as the code change. Don't defer it to a later cleanup pass; that's exactly how this doc went nine commits stale.
- Treat every claim in `06_ROADMAP.md`, `SESSION_HANDOVER.md`/`CONTEXT_HANDOVER.md` (if present), or any other continuity/handoff doc as unverified until checked against real `git log`/`git show`/`grep`/file contents. Never repeat a doc's claim into a new doc, a task summary, or a code comment without independently confirming it first — especially claims phrased as "still missing," "placeholder," "not yet committed," or "unfixed."
- If a task's own investigation surfaces a stale or wrong claim elsewhere in the docs — even one unrelated to the task at hand — flag it in the task summary rather than silently ignoring it or working around it.
- `LEARNING_LOG.md`'s Mistakes & Fixes entries are written for other AI agents and future sessions, not just Aadi — assume the reader has no memory of this conversation and needs the full story to avoid repeating the mistake.

## Data Wipe Checklist (any task that deletes real rows from the live database, not just test fixtures)
1. Scope every table explicitly, by name — never act on a vague phrase like "clean up test data" or "wipe the rest." If a table isn't named, it isn't in scope.
2. Verify test-vs-real against actual row content (dates, quantities, factory/party match, transaction notes) — never from `isActive`/naming-pattern flags alone. A flag can be wrong or stale; the data itself isn't.
3. Map every FK relationship via `information_schema` directly, in **both** directions — including from any table that's supposed to stay untouched **into** the wipe scope, not just the direction the wipe scope points outward.
4. Specifically hunt for `SET NULL` relations, separately from `RESTRICT`/`CASCADE` — `SET NULL` changes data silently without changing row counts, so a count-only check is structurally blind to it.
5. Derive deletion order from the FK map — never guess it or assume it matches the order tables were mentioned in.
6. Confirm a real safety net (a backup, or a platform's own auto-restore/point-in-time window) exists before anything irreversible runs. Don't proceed on "it's probably fine."
7. Take a full pre-deletion snapshot (every row, not just counts) AND verify the write succeeded by reading it back and comparing — don't assume a `console.log` saying "saved" means the file reached disk.
8. Execute inside one atomic transaction, with a hard assert on every single step's affected-row count against what was expected — abort and roll back the whole thing on any mismatch, never proceed partway.
9. Verify keep-scope tables field-by-field wherever any `SET NULL` relation could have touched them — a stable row count is not proof nothing changed.
10. Run real application code/endpoints against the emptied tables, not just direct queries — an empty result set can break a query that assumes at least one row exists (an average, a `.find()`, a bare array index) in a way a raw count check would never surface.
11. The human independently re-verifies with their own script — never close out a wipe on the agent's summary alone.
12. Document what was wiped and why in `LEARNING_LOG.md`, then commit.

## Comments & teaching (I'm learning full-stack dev from zero — backend AND frontend both need the same depth of explanation, nothing gets skipped because it's "just frontend" or "just styling")
- Comment **why**, not just what — applies equally everywhere: Express routes and Prisma queries get the same explanatory treatment as React components, state management, and hooks.
- `LEARNING_LOG.md` has three sections: **Decisions & Reasoning**, **Mistakes & Fixes**, and **Concepts**. Update all three continuously as things happen, not batched at the end of a task.
- **Mistakes & Fixes entries are mandatory whenever something doesn't work on the first attempt** — not just for major bugs. Every entry must cover, in order: (1) the original approach and why it seemed right at the time, (2) what actually went wrong and how it was noticed, (3) how the real cause was diagnosed, (4) the fix that was applied, and (5) **why that specific fix is the correct one** — the actual reasoning for why it addresses the real cause, not just "a" fix that happened to make the error go away.
- Concept entries must be genuinely complete, not a one-line dictionary definition: include whatever prerequisite context is needed to actually understand it (don't assume knowledge that hasn't been logged yet), how it connects to concepts already in the log, and a concrete example from this project's own code where possible — not just an abstract definition. This applies to frontend concepts (components, props, state, hooks, rendering) exactly as much as backend ones.
- After finishing a task, give a full plain-English walkthrough of what was built and why, before I review the diff — covering backend and frontend equally, assume zero prior background in either.
- If I ask "explain this like I'm new to backend dev" or "new to frontend dev," slow all the way down for that side specifically — no assumed prior knowledge.
