# Learning Log

Two things live here: **Decisions & Reasoning** (why we built things the way we did, what we didn't do instead, and why) and a **Concepts** glossary at the bottom. This file grows continuously as the actual build happens — not just at the end of a task, but the moment a real decision gets made or a new concept comes up. Concept entries aim to be complete enough to actually understand the idea, including whatever context it depends on, not just a one-line definition. See CLAUDE.md for the full instruction. This file is the "why" behind everything; the other docs in `/project-docs` are the "what."

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

### Why Prisma is pinned to 6.19.3 instead of the latest 7.x
`npm install` grabbed Prisma 7.9.1 by default (npm always installs latest unless told otherwise), but Prisma 7 requires Node 20.19+/22.12+/24+, and this machine runs Node 20.12.2 — installing `prisma`'s CLI package failed outright on a preinstall check. Rather than force a Node upgrade mid-task (out of scope for "set up the backend"), pinned both `prisma` and `@prisma/client` to `6.19.3`, the latest release in the 6.x line, which only requires Node 18.18+. Revisit this pin if Node ever gets upgraded on this machine.

### Why jsonwebtoken/express-session weren't installed yet
`02_ARCHITECTURE.md` §4.1 explicitly leaves session-vs-JWT as an open choice ("either is acceptable, pick one"). That's a real auth-design decision, and building auth is its own future task — so this task (npm init + minimal server) only installed what's needed for *any* server to exist (express, cors, dotenv, bcrypt, prisma), not the auth-token library itself. Avoids default-picking an approach that should get a deliberate answer when we actually build login.

### Why cors and dotenv were added even though the doc only names Express/Prisma/bcrypt
Neither is a business-logic choice — they're plumbing required by decisions already made elsewhere in the doc: `cors` exists because frontend and backend are separate deployments (§3), so the browser needs an explicit "this origin is allowed" signal or every request gets blocked. `dotenv` exists because the doc's own env var list (§7) has to be loaded into the app somehow. Neither adds a new capability beyond what was already decided; they just implement it.

### Why History edits create a new entry instead of overwriting in place
The founding principle for the whole system is that every number traces back to a logged event — nothing is ever just manually edited with no trace. A literal in-place edit (even with an "(edited)" tag) still destroys the original value. A new correcting entry costs a little more complexity but keeps that principle intact even when accommodating real mistakes.

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

**Routes vs. Controllers** — two files usually cooperate to handle one endpoint. The *route* file (e.g. `backend/src/routes/stock.js`) just declares "when a request hits this URL with this HTTP method, call this function" — it's a directory, not logic. The *controller* file (e.g. `backend/src/controllers/stockController.js`, once it exists) holds the actual logic that runs: reading the request, talking to the database via Prisma, deciding what to send back. Splitting them keeps "what URL triggers this" separate from "what actually happens," so a route file stays short and skimmable even as the underlying logic grows. Middleware (see above) sits in front of both — it runs before the route's handler gets control at all.

