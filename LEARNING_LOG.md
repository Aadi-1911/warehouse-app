# Learning Log

Three things live here: **Decisions & Reasoning** (why we built things the way we did, what we didn't do instead, and why), **Mistakes & Fixes** (real problems hit during the build, how they were diagnosed, and why the actual fix is correct — not just a workaround), and a **Concepts** glossary. This file grows continuously as the actual build happens — the moment a real decision gets made, something breaks, or a new concept comes up, even mid-task. Covers backend and frontend equally. Concept entries aim to be complete enough to actually understand the idea, including whatever context it depends on, not just a one-line definition. See CLAUDE.md for the full instruction. This file is the "why" (and "what went wrong") behind everything; the other numbered `.md` docs in this folder are the "what."

---

## Decisions & Reasoning

### Why this business, this way (the founding idea)
The project serves two goals at once: a real tool for a real wholesale garment business, and a genuine full-stack learning project. When they conflict, the business wins — this was stated explicitly early on ("if it's boring, it should be a win for the business, not the resume"). This single rule ended up settling almost every later scope argument without needing a fresh debate each time.

### Why Phase 1 is Inventory only, not the full system
The full picture that emerged through design (Inventory + Parties + Orders + Billing + Payments) is, honestly, a lightweight ERP — a much bigger build than "an inventory app." Rather than building all of it before shipping anything, we cut to the single piece that mattered most *right now*, confirmed directly rather than assumed. Building everything at once would have meant months of planning with nothing real in daily use, and no early feedback to catch mistakes cheaply. Shipping Inventory alone, in real use, teaches more per hour than a bigger unfinished build ever would.

### Why React is kept separate from the backend (not Next.js)
Next.js would merge frontend and backend into one project — less boilerplate, but it hides the actual HTTP request/response boundary between client and server. Keeping them as two separate projects forces genuine understanding of what a REST API is, why CORS exists, and how a real client talks to a real server — foundational, transferable knowledge that a merged framework lets you skip entirely. The cost (a bit more deployment complexity, two services instead of one) is small next to what's gained.

### Why Prisma over raw SQL
Raw SQL (writing every query and migration by hand) teaches the most, but costs the most time for a total beginner — a real risk against a job-hunting timeline. Prisma turned out to be the rare case where the *easier* option isn't actually a shortcut: the schema file is basically a formalized version of the entity model already designed by hand, migrations are generated and inspectable, and Prisma Studio gives a real GUI into the data. The habit that keeps it honest: periodically turn on query logging and read the SQL it generates, so it never becomes a total black box.

### Why auth is hand-rolled, not a managed service (Clerk/Auth0/etc.)
At 2–5 users, a managed auth service doesn't save much real time — and the app has a genuinely non-standard requirement (role check *plus* a separate PIN specifically for price edits) that doesn't fit a generic login SDK's assumptions anyway. Rolling it means real, interview-relevant understanding of password hashing, sessions, and protected routes, for roughly the same effort as fighting a tool that wasn't built for this shape of requirement.

### Why a website (PWA), not a native app
Native apps earn their complexity when they unlock something a browser genuinely can't do well — offline-first sync, camera/barcode scanning, heavy push notifications. None of those are actually needed here: connectivity in the field is mostly reliable (occasional drops fall back to manual re-entry), and there's no barcode-scanning workflow in how articles get selected. A skilled team with unlimited resources would build the same thing — a responsive PWA — because nothing about the actual business creates an advantage for native at this scale.

### Why Bundle = Product + Color, and sizes are fixed per Product
Early assumption was that sizes might need tracking per bundle or per color. Stress-testing against how the business actually operates revealed the size range is always the same for a given article — a different size range simply gets a different Article No. entirely. This *simplified* the model rather than complicating it: sizes belong once, at the Product level, not duplicated everywhere a color or bundle appears.

### Why Stock is a join table (Bundle × Location), not a single number per Bundle
A single stock count per Bundle couldn't represent the real situation: the same Bundle (e.g. Article A101 in Navy) can have different quantities sitting in Delhi versus Gurgaon. Splitting Stock out as its own table, keyed on both Bundle and Location, was the only way to represent that truthfully.

### Why cost_price/sellingPrice are nullable ("pending price"), not required at creation
Forcing a price to be set the moment an article is created would block staff from logging a receiving session for a genuinely new article until the owner was available — unrealistic given staff and owner are never even on the same device (phone vs. PC). Making price nullable let receiving and pricing become two independent steps: staff can log what physically arrived immediately, and a "pending price" badge naturally signals what still needs the owner's attention, without inventing a separate approval workflow.

### Why price editing needs a PIN, not just the owner role
This one got revised. The first answer was "owner-role login is enough" — but that quietly dropped an explicit original requirement (owner wanted protection "even for himself," given how sensitive cost data is). Revisiting it: role alone proves *who's logged in*, not that *this specific action* was intentional. The PIN is a second, action-specific confirmation — small cost, but it restores a requirement that almost got lost in simplification.

### Why Order status is four stages, not three
A prototyping tool's demo collapsed this to Open → Packed → Shipped, skipping "Billed" entirely. But billing is a genuinely separate, harder problem (a real invoice document, GST fields, e-way compliance) that hasn't even been designed yet — collapsing it into "shipped" would hide that dependency and make it easy to accidentally ship something that was never properly billed. Keeping Billed as its own stage keeps that gap visible instead of papered over.

### Why "adjusted" is a logged event, not a status value
Orders can change at any point — before packing, during packing, even after, per how the business actually operates. Modeling that as a status (`Placed → Adjusted → Packed`) would require illegal-looking backward transitions once packing had already started. Instead, status stays simple and linear (Placed → Packed → Billed → Shipped), and every change is a separate append-only log entry layered on top — the full history is visible without corrupting the simple state machine.

### Why payments default to FIFO but allow a mandatory-reasoned override
Most payments are simple — pay the oldest bill first. But real Parties don't always pay against the bill you'd expect. Forcing pure FIFO would misrepresent reality; allowing free-form override with no record would make it untraceable. Requiring a note *specifically when* someone overrides the default keeps the common case frictionless while keeping every exception explainable later.

### Why the "outstanding amount" tracker is separate from the real Bill
Full invoice generation (matching the business's actual Excel template, GST fields, e-way thresholds, immutability, corrections) is a genuinely bigger, harder, still-undesigned problem. But the owner needs *some* visibility into who owes what well before that's built. Splitting them meant shipping real value now without waiting on — or accidentally under-designing — the harder piece.

### Why Kids sizing reuses the adult sizing rule instead of a new 4pc/6pc lookup table
The obvious approach would hardcode "kids sets are 4 or 6 pieces." But the adult rule (pieces-per-set = however many size options got selected) already generalizes perfectly to age brackets — 4 brackets selected = a 4pc set, 6 selected = a 6pc set. Recognizing the existing rule already covered the new case avoided inventing and maintaining a second, redundant system.

### Why low-stock is a small badge, never a fully-tinted card
An early version tinted the whole card/row for any shortfall. In practice, that trains people to tune out red over time (alarm fatigue) — and makes genuinely urgent situations blend in with routine ones. A small flag, reserved for a specific threshold (≤2 sets), stays meaningful precisely because it's rare.

### Why session items snapshot their Factory/Location/price instead of reading it live
If a receiving session's item just referenced the session-level Factory/Location dropdown, changing that dropdown mid-session (e.g. realizing halfway through that goods are actually going to a different warehouse) would silently corrupt every item already entered. Capturing those values on each item *at the moment it's finalized* means later changes can't reach backward and corrupt earlier data — a real bug class avoided by design rather than caught by testing.

### Why jsonwebtoken/express-session weren't installed yet
`02_ARCHITECTURE.md` §4.1 explicitly leaves session-vs-JWT as an open choice ("either is acceptable, pick one"). That's a real auth-design decision, and building auth is its own future task — so the backend-init task (npm init + minimal server) only installed what's needed for *any* server to exist (express, cors, dotenv, bcrypt, prisma), not the auth-token library itself. Avoids default-picking an approach that should get a deliberate answer when we actually build login.

### Why cors and dotenv were added even though the doc only names Express/Prisma/bcrypt
Neither is a business-logic choice — they're plumbing required by decisions already made elsewhere in the doc: `cors` exists because frontend and backend are separate deployments (§3), so the browser needs an explicit "this origin is allowed" signal or every request gets blocked. `dotenv` exists because the doc's own env var list (§7) has to be loaded into the app somehow. Neither adds a new capability beyond what was already decided; they just implement it.

### Why the schema was transcribed from 03_DATABASE_SCHEMA.md §1 rather than redesigned
That document already *is* the finalized Phase 1 data model — the entity design work happened when it was written, not now. Copying it verbatim (including its own inline comments) avoided silently second-guessing decisions already made, and kept that task scoped to "get the schema into the database," not "redesign the schema."

### Why the schema alone doesn't enforce cost_price visibility, the PIN gate, or atomic stock writes
Prisma's schema language can describe *shape* (a `Decimal?` field can hold null or a number) but not *behavior* (who's allowed to read a field, or that a write must happen alongside an audit row). Those four rules — no `cost_price` to STAFF, PIN + OWNER role to edit prices, Stock only changes via a `Transaction` insert, Bundle/Color pairs validated before accepting a transaction — all have to be checked in the Express controllers/middleware that sit in front of Prisma, not in the schema file itself. The schema just makes the *right* shape possible (e.g. `Stock.qtySets` has no API to edit it directly yet — there's no route for that at all).

### Why the database was checked for existing tables before migrating
`prisma migrate dev` can be destructive if it detects drift against an already-populated database (it may prompt to reset). Since the Neon database was freshly provisioned, checked first with `prisma migrate diff --script` (prints the SQL Prisma would run without applying it) — confirming it was 100% `CREATE TABLE`/`CREATE TYPE` with no `ALTER`/`DROP` statements, meaning the database was genuinely empty and there was nothing at risk of being overwritten.

### Why History edits create a new entry instead of overwriting in place
The founding principle for the whole system is that every number traces back to a logged event — nothing is ever just manually edited with no trace. A literal in-place edit (even with an "(edited)" tag) still destroys the original value. A new correcting entry costs a little more complexity but keeps that principle intact even when accommodating real mistakes.

---

## Mistakes & Fixes

Every entry here follows the same five-part structure, backend or frontend, no exceptions: **(1) Original approach** — what was tried first and why it seemed right at the time. **(2) What went wrong** — the actual symptom, and how it was noticed. **(3) Diagnosis** — how the real cause was tracked down, not just guessed at. **(4) The fix** — what was actually changed. **(5) Why this fix is correct** — the reasoning for why it addresses the real cause, not just a workaround that happened to make the symptom disappear.

### Prisma CLI install failing outright on this machine
**(1)** Ran a plain `npm install -D prisma nodemon` in the backend, expecting npm to grab the latest stable release like any other package. **(2)** The install failed outright: `npm ERR!` from `prisma`'s own preinstall script, refusing to proceed. **(3)** The error message named the actual cause directly — Prisma 7.x requires Node `^20.19 || ^22.12 || >=24.0`, and this machine runs Node `20.12.2`, just short of the 20.19 floor. **(4)** Pinned both `prisma` and `@prisma/client` to `6.19.3` (confirmed via `npm view prisma@6 version`/`engines` to be the latest 6.x release, requiring only Node `>=18.18`) instead of the default-installed 7.9.1. **(5)** This is the correct fix, not a workaround, because it resolves the actual incompatibility (wrong engine requirement for this Node version) without touching Node itself — upgrading Node was out of scope for "initialize the backend," and both packages are still on a genuinely current, supported release line.

### Prisma Studio: "Response from the Engine was empty" on every query
**(1)** The reporting hypothesis was version drift between `prisma` and `@prisma/client` (reasonable, given the 7.x/6.19.3 pinning incident above), or a corrupted/wrong-architecture query engine binary. **(2)** Studio's browser UI threw "Response from the Engine was empty" the moment any model (confirmed on `Factory`) was queried. **(3)** Diagnosed layer by layer instead of guessing: `npx prisma -v` showed `prisma` and `@prisma/client` both at exactly `6.19.3` (no drift); the engine binary at `node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node` was the correct size (~19MB, not truncated), a valid Mach-O arm64 binary matching this machine's actual architecture (`uname -m` → arm64), ad-hoc code-signed as expected for Prisma's Mac binaries, with no macOS quarantine flag blocking it, and all its dynamic library dependencies were plain system frameworks (Security, CoreFoundation, libSystem — nothing third-party to fail to resolve). A direct `@prisma/client` query (`prisma.factory.findMany()`) run from a small standalone script succeeded immediately, returning `[]`. To rule out something Studio-specific, traced Studio's own bundled server code (`node_modules/prisma/build/index.js`) to find its internal `/api` JSON-RPC endpoint, then replayed the exact `getDMMF` + `clientRequest` calls a real browser tab sends against a freshly started Studio instance — that succeeded too, returning the empty `Factory` table correctly. A process check also confirmed no stale Studio process was left running from whatever earlier session hit the error. **(4)** No code change was needed — every layer (dependency versions, the engine binary itself, the live database connection, and Studio's own request/response protocol) checked out working correctly against a fresh instance. **(5)** Since the identical schema, database, and engine binary succeed end-to-end when driven fresh, the original error couldn't have come from a persistent defect in this project's dependencies or files — the most consistent explanation is transient/stale state from the earlier session (e.g. a Studio tab left open from before the migration existed, whose cached schema hash no longer matched the database, or a since-closed Studio process in a bad state). If this recurs: fully close old Studio browser tabs/processes and relaunch fresh with `npx prisma studio --schema=src/prisma/schema.prisma`.

---

## Concepts

**ORM (Object-Relational Mapper)** — Prisma, in our case. Instead of writing raw SQL by hand to talk to the database, you describe your data as JavaScript-like objects and the ORM translates that into SQL for you. You still end up understanding the database structure (the schema file basically *is* your data model), you just don't hand-write every query.

**Migration** — a recorded, versioned change to the database structure (e.g. "add a Product table"). Every time the schema changes, a new migration file gets created so the change can be applied to any copy of the database (your laptop, the live server) in the same order, and so there's a history of how the database evolved over time.

**Middleware** — code that runs *in between* a request arriving at the backend and it actually being handled. Used here for things like "check the user is logged in" or "check the user's role is OWNER" before the real endpoint logic even runs — a gatekeeper step.

**async / await** — most backend code has to wait on something slow (a database query, a network call) before it can continue. `async`/`await` is JavaScript's way of writing "pause here until this finishes" without freezing everything else the server is doing. You'll see it on almost every backend function that touches the database.

**REST API / endpoint** — a REST API is just an agreed set of URLs (endpoints) the frontend can call, each doing one specific thing (e.g. `POST /api/transactions` = "log a stock movement"). "Endpoint" just means one specific URL+action combination.

**Environment variable** — a setting (like the database connection string or a secret key) kept outside the actual code, usually in a `.env` file, so secrets never get committed to version control and the same code can run against different databases (your laptop vs. the live server) without editing code.

**JWT / session** — after you log in, the server needs a way to know it's still you on the next request without asking for your password every time. A session (a reference stored server-side) or a JWT (a signed token stored client-side) are two ways of doing that. We're using one of these — check the current code for which.

**package.json / npm install** — `package.json` is a project's manifest: its name, and every external library (package) it depends on. Running `npm install <package>` downloads that package (and anything *it* depends on) into a local `node_modules/` folder, and records the version in `package.json`'s `dependencies`. Anyone else who clones the project just runs `npm install` with no arguments and gets the exact same set of packages — the code itself doesn't need to be copied, just the manifest.

**dependencies vs. devDependencies** — both live in `package.json`, but mean different things. `dependencies` (installed with plain `npm install <pkg>`) are packages the app needs *at runtime* — e.g. `express`, since the live server actually calls into it. `devDependencies` (installed with `npm install -D <pkg>`) are tools only needed *while building/developing* — e.g. `nodemon`, which restarts the server on file changes but has nothing to do with how the deployed app behaves. Keeping them separate matters because some deployment steps install only `dependencies` to keep the production install smaller.

**CORS (Cross-Origin Resource Sharing)** — by default, a browser blocks JavaScript running on one origin (e.g. the Vite dev server at `localhost:5173`) from making requests to a different origin (e.g. the Express API at `localhost:3001`) — a security default, not a bug. The `cors` middleware on the backend explicitly tells the browser "requests from this specific origin are allowed," via the `Access-Control-Allow-Origin` response header. This only became necessary *because* frontend and backend are two separate projects/deployments (see the Next.js decision above) — a merged framework wouldn't hit this at all, since there'd be no cross-origin request to begin with.

**nodemon** — a dev-only tool that watches your backend source files and automatically restarts the Node process whenever one changes, so you don't have to manually stop/rerun `node src/server.js` after every edit. Only affects the local dev workflow — production runs plain `node src/server.js` (the `start` script), not nodemon.

**Migration (in practice, this project's first one)** — running `npx prisma migrate dev --name init_phase1_inventory` did two things: (1) generated a `migration.sql` file under `backend/src/prisma/migrations/` containing the actual `CREATE TABLE`/`CREATE TYPE` SQL for every Phase 1 model (User, Factory, Product, ProductSize, Color, Bundle, Location, Stock, Transaction), and (2) ran that SQL against the real Neon Postgres database, plus recorded in a `_prisma_migrations` table that this migration has been applied. That migration file is what makes the schema change reproducible — anyone else (or a future deployment) runs the same file against their own database and ends up with identical tables, instead of everyone hand-typing `CREATE TABLE` statements and hoping they match.

**Enum (in Prisma)** — a field restricted to one of a fixed set of named values, enforced by the database itself, not just application code. This schema has two: `Role` (`OWNER`/`STAFF`) and `TransactionType` (`STOCK_IN`/`STOCK_OUT`/`SAMPLE_OUT`/`SAMPLE_RETURN`). Trying to insert a `User` with `role: "MANAGER"` would fail at the database level, not just get silently accepted — a safety net beneath whatever the application code checks.

**Foreign key / relation** — e.g. `Product.factoryId` plus the `factory Factory @relation(...)` line: this tells Postgres that every `Product.factoryId` value must correspond to a real row in the `Factory` table — you can't create a `Product` pointing at a `Factory` that doesn't exist. Prisma turns each of these into a real foreign-key constraint at the database level, not just a naming convention.

**`@@unique([a, b])` (composite unique constraint)** — a uniqueness rule spanning *two* columns together, rather than one column alone. `Product` uses `@@unique([articleNo, factoryId])`: two different factories can both have an article "A101" (each unique *within* its own factory), but the same factory can't have two Products both named "A101" — enforcing "article numbers unique per Factory, never globally" (CLAUDE.md's non-negotiable rule) directly at the database level, not just in application logic.

**Routes vs. Controllers** — two files usually cooperate to handle one endpoint. The *route* file (e.g. `backend/src/routes/stock.js`) just declares "when a request hits this URL with this HTTP method, call this function" — it's a directory, not logic. The *controller* file (e.g. `backend/src/controllers/stockController.js`, once it exists) holds the actual logic that runs: reading the request, talking to the database via Prisma, deciding what to send back. Splitting them keeps "what URL triggers this" separate from "what actually happens," so a route file stays short and skimmable even as the underlying logic grows. Middleware (see above) sits in front of both — it runs before the route's handler gets control at all.

**JSON-RPC over HTTP (as used by Prisma Studio)** — a pattern where instead of many differently-shaped REST endpoints (`GET /factories`, `POST /products`, ...), a client sends every request to *one* URL (Studio uses `POST /api`) with a JSON body naming which "action" it wants (e.g. `{ action: "clientRequest", payload: { modelName: "Factory", operation: "findMany" } }`), and the server dispatches internally based on that field. Found this while tracing today's Studio investigation — Studio's browser UI talks to its own local Node server this way, which in turn calls the same generated Prisma Client this project's own code uses.

