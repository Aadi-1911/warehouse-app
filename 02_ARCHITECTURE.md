# Architecture Document
## Wholesale Garment Business Management System — Phase 1

---

## 1. Tech Stack (final)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React (Vite), kept as a **separate project/deployable** from the backend — not Next.js | Deliberate: forces explicit client-server boundary understanding rather than a merged framework hiding it |
| Backend | Node.js + Express | Standard REST API, explicit routing/middleware |
| Database | PostgreSQL | Relational — fits the linked-entity data model (Products, Bundles, Stock, Transactions all have real foreign-key relationships) |
| ORM | Prisma | Schema-first, generates migrations, includes Prisma Studio (GUI for inspecting real data) — chosen over raw SQL because it costs less beginner time while remaining transparent (enable query logging to see generated SQL) |
| Auth | Custom-built (bcrypt password hashing + session or JWT-based auth) | Not a managed auth SDK — the app's role model (OWNER/STAFF) plus a non-standard PIN-gate on price editing doesn't fit generic auth service assumptions, and rolling it builds real, interview-relevant understanding |
| Frontend hosting | Vercel | Free tier, live URL |
| Backend hosting | Railway or Render | Free tier, live URL |
| Database hosting | Neon or Supabase (Postgres, hosted) | Free tier |
| Platform | Responsive website, installable as a **PWA** | Not a native app — see Section 5 |

---

## 2. Why a Website (PWA), Not a Native App

Evaluated against the actual business workflow, not against generic "modern app" defaults:

- **No offline-first requirement** — staff connectivity at shops is reliable most of the time; the accepted fallback for the rare drop is manual re-entry (Phase 2), not automatic sync.
- **No barcode/camera-scanning workflow** — articles are selected via dropdowns (Article No. + Color), not scanned. (If the business later adopts barcode labels, camera-based scanning becomes a legitimate reason to reconsider — not currently the case.)
- **Push notifications**, if ever needed (e.g. payment-due reminders in a later phase), are supported by modern PWAs without requiring a native app.
- A single responsive PWA serves **both** device profiles (staff phone-only, owner PC-only) from one codebase, rather than maintaining separate builds.

**Action item:** make the app installable as a PWA (manifest + service worker config), primarily so staff can add it to their phone home screen. Lower priority for the owner's PC use, where a bookmarked tab is sufficient.

**Platform note:** Android (Chrome) shows an automatic install prompt — one tap. iOS (Safari) has no auto-prompt; installing requires Share button → "Add to Home Screen," a manual multi-step action. Once installed, both behave identically as a full-screen app. If any staff use iPhones, this manual step is worth walking them through once during onboarding.

---

## 3. Why React + Express Are Kept Separate (not Next.js)

Next.js would merge frontend and backend into one project with less boilerplate. This is intentionally avoided for Phase 1 because:
- It hides the REST API / HTTP request-response boundary that is core, transferable full-stack knowledge.
- Keeping them separate mirrors how many real companies architect systems (separately deployed frontend and backend), which is itself relevant experience.
- The marginal added complexity (CORS config, two deployments instead of one) is small relative to the learning value.

---

## 4. Auth & Authorization Design

### 4.1 Password auth
- Passwords hashed with bcrypt (or argon2) — never stored plaintext.
- Session-based or JWT-based auth (either is acceptable; pick one and apply consistently). Session token stored client-side, validated server-side on every request.

### 4.2 Role-based access control
- Every User has `role ∈ {OWNER, STAFF}`.
- Middleware on the backend must check role server-side on any endpoint returning or mutating `cost_price` or `selling_price` — **never rely on the frontend to hide these fields**. The API itself must not return `cost_price` in any response to a STAFF-role request.

### 4.3 PIN gate on price editing (OWNER only, additional to role check)
- `User.price_edit_pin_hash` — a separate hashed PIN, distinct from the login password, tied to the owner account.
- Only relevant because there is currently one OWNER account. If a second owner-level account is ever added, this needs revisiting (not currently in scope).
- Any request that edits `cost_price` or `selling_price` must verify BOTH: (a) `role == OWNER`, AND (b) a valid PIN submitted with the request, matched server-side against `price_edit_pin_hash`. Failing either check rejects the write. PIN is entered at the moment of the edit, not once per session.

---

## 5. Data Integrity Principles (apply throughout)

- **No floating stock numbers.** Every change to `Stock.qty_sets` or `Stock.qty_reserved_for_sample` must result from an inserted `Transaction` row. Never allow a direct UPDATE to Stock quantities outside of transaction-creation logic.
- **Server-side validation always**, even where the frontend also validates (e.g., dropdown-only inputs). Never trust client-submitted data as pre-validated.
- **Bundle-Color validity check**: when creating a Transaction or any Bundle reference, the backend should only accept Color values that have an actual Bundle row for that Product — don't allow arbitrary Product+Color combinations to be silently created via a transaction endpoint.

---

## 6. Suggested Folder Structure

```
/frontend
  /src
    /components       # reusable UI (buttons, dropdowns, forms)
    /pages             # Add Stock Entry, Live Stock View, Login, etc.
    /api               # fetch wrappers calling the backend REST API
    /hooks
    App.jsx
  vite.config.js
  package.json

/backend
  /src
    /routes            # one file per resource: products.js, stock.js, transactions.js, auth.js, factories.js, colors.js, bundles.js, locations.js, users.js
    /middleware         # auth.js (session/JWT check), requireRole.js, requirePin.js
    /prisma
      schema.prisma
    /controllers        # business logic per route
    server.js
  package.json
```

---

## 7. Environment Variables (indicative — finalize during setup)

**Backend:**
- `DATABASE_URL` — Postgres connection string (Neon/Supabase)
- `JWT_SECRET` or `SESSION_SECRET`
- `NODE_ENV`
- `CORS_ORIGIN` — frontend's deployed URL

**Frontend:**
- `VITE_API_BASE_URL` — backend's deployed URL

---

## 8. Deployment Topology

```
[React PWA] --(HTTPS, REST/JSON)--> [Express API] --(Prisma)--> [PostgreSQL]
   Vercel                              Railway/Render                Neon/Supabase
```

Two independently deployable services plus a managed database — matches real-world multi-service deployment patterns.
