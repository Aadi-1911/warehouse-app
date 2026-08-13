# UI Design Brief — Wholesale Garment Business Management App
## For AI UI generation (e.g. Stitch) — Phase 1 + Phase 2 core screens

You are designing a mobile-first business app for a small wholesale garment company. Follow every specification below precisely — these are confirmed decisions from iterative design review, not suggestions.

---

## 1. Product Context

A wholesale garment business sources garments from factories and distributes them in bulk to retail shopowners ("Parties"). This app replaces manual tracking (notebooks, memory, WhatsApp photos) with a structured system for inventory, receiving, and order-taking.

## 2. Users & Devices — strict split, design accordingly

| Role | Device | Access |
|---|---|---|
| **Staff** | **Phone only** | Logs stock movements, receives shipments, takes orders. Never sees cost price. |
| **Owner** | **Both PC and phone** | Full access, pricing, approvals. Owner screens must work on mobile too, not assume desktop-only. |

**All screens in this brief are for the Staff role, mobile-first.** Design for one-handed thumb use: large tap targets (minimum ~40px), minimal free-text typing, dropdowns/chips/steppers preferred over keyboard input wherever the underlying data is structured.

---

## 3. Design Language

### 3.1 Color — semantic, not decorative. Each role has a fixed meaning, applied consistently everywhere:

| Role | Meaning | Used for |
|---|---|---|
| **Success (green)** | Positive / increasing | "Stock in" actions, matched/confirmed states, fully-packed order lines |
| **Danger (red)** | Negative / removal | "Stock out" actions, damaged-item flags |
| **Warning (amber)** | Needs attention | Low-stock badges, short-packed order lines, new-article-pending-price status |
| **Accent (blue)** | Primary navigation / neutral action | Primary buttons, Live Stock View branding, filter chips |
| **Highlight (purple)** | Order/Party-related | New Order screen branding, cart "Add" actions |

A component's background/border/text should always share the same role tint together (e.g., a warning badge uses warning-tinted background, border, AND text — never mix roles within one element).

### 3.2 Layout components (reuse across all screens)

- **Screen header**: small rounded-square icon mark (role-tinted background + icon), next to two-line text block — small muted "app name" line above, larger title line below. Present on every screen.
- **Cards**: rounded corners (~12px), thin border, used to group related content (a form section, an article's colors, a summary stat).
- **Steppers**: circular +/− buttons flanking a centered number, for all quantity input. Never use a raw number input field for quantities.
- **Segmented/tile selectors**: for choosing between a small fixed set of options (e.g. movement type). Unselected = neutral gray. Selected = filled with the option's semantic role color, colored border, colored text/icon.
- **Badges**: small pill shape, icon + short label, role-tinted. Used for status flags (Low stock, Damaged, New · pending price, Matched).
- **Sticky bottom action bar**: primary action button (accent-filled, full width, rounded) pinned to the bottom of the screen, often preceded by a one-line dynamic summary of the current state.
- **Accordion groups**: for any list grouped by Article — collapsed by default, header row shows Article No + name + a count badge (e.g. "3 colors") + low-stock badge if relevant + a chevron. Tapping expands a resizing panel below showing the detail rows. Multiple groups can be open independently.

### 3.3 Terminology — use these exact user-facing labels, never raw technical/schema terms

| Internal concept | Label shown to staff |
|---|---|
| Bundle (Product + Color) | "Set" |
| Stock quantity | "Sets" / "Piece count" |
| Transaction | Not shown as a term — appears as an activity/history list |

---

## 4. Critical Interaction Rules (do not violate)

1. **Never show an exact stock number during live order-taking** (New Order screen). Show only a "Low stock" warning badge when relevant — absence of the badge signals adequate stock. Exact numbers ARE shown on Live Stock View and Pack Order (internal/warehouse-facing screens), just never on the customer-facing order-taking screen.
2. **cost_price is never shown to Staff**, on any screen, under any circumstance.
3. Article-number entry during receiving must branch: if the number matches an existing article **for the selected Factory**, show a green "Matched" confirmation and only require Color + Sets. If no match, show an amber "New article" state requiring Name + Sizes in addition to Color + Sets. Matching is always scoped to the selected Factory — the same article number can validly exist under a different Factory.
4. A newly-created article gets a "New · pending price" badge — it has no price until the owner sets one (owner-only, separate screen, not shown here).
5. Color options shown for any article must be filtered to only that article's actual existing colors — never show the full global color list indiscriminately.

---

## 5. Screens to Generate

### 5.1 Home
- Header: app icon mark + "Warehouse" / greeting with staff name.
- 2×2 grid of large square tiles: Receive Stock (green), New Order (purple), Pack Order (amber), Live Stock (blue) — each with an icon and label, tinted by its role color.
- Bottom note (**STAFF role only** — showing this to OWNER would be false, since pricing is their screen, not hidden from them): small muted banner stating pricing/article setup is owner-only and hidden from this account.

### 5.2 Receive Stock
- Header (green-tinted icon: delivery truck).
- Top: two side-by-side dropdowns — Factory, Location. **One receiving session = one Location, selected once.**
- "Add article to receipt" card:
  - Article No. text input + a "Check" button.
  - On check: either a green "Matched: [no] — [name] (sizes already set)" banner, OR an amber "New article" banner revealing Name + Sizes fields.
  - Color dropdown, Sets stepper.
  - "Damaged on arrival" checkbox.
  - "Add to receipt" button (green-tinted).
- Below: a running list of added items for this session — each row shows article/name/color/sets, with "New · pending price" and/or "Damaged" badges where applicable, removable.
- Sticky footer: "Save receipt (N items)" button.

### 5.3 New Order
- Header (purple-tinted icon: shopping bag), showing the selected Party's name as a subtitle.
- Party dropdown at top (known repeat Parties + a "Walk-in / one-off" option).
- Article card: shows one article's name, with its colors as **checkable chips** (multi-select — several colors of the same article can be picked together). Any color with low stock gets an inline amber "Low stock" badge — never an exact number.
- Each checked color reveals its own inline quantity stepper.
- One "Add selected" button adds ALL currently-checked colors (with their quantities) together as one grouped action.
- Below: "Order summary" — cart entries grouped by article, with color/quantity sub-lines, removable.
- Sticky footer: "Review order (N)" button.

### 5.4 Pack Order
- Header (amber-tinted icon: package), Party name subtitle, status badge ("Placed").
- List of order line items, each as a card:
  - Article + color name, plus a status icon: green check (fully matched), amber warning triangle (short), or dashed gray circle (not started).
  - "Ordered: N sets" label.
  - A "Packing" stepper, editable, defaulting to the ordered quantity.
  - If packing quantity is less than ordered (e.g. insufficient stock), the whole card takes an amber tint and shows "Ordered: X · Only Y in stock" plus a note that the order will adjust automatically for the shortfall.
- Sticky footer: a one-line tally ("1 of 3 items fully packed · 1 short · 1 not started") above a "Mark as packed" button.

### 5.5 Live Stock View
- Header (blue-tinted icon: search/list).
- Row of 3 small stat cards: Articles (count), Total sets (count), Low stock (count, amber-tinted card).
- Search bar (search article or color).
- Below: **accordion list grouped by article**, collapsed by default. Each header row: Article No + name, a "N colors" count, a "Low" badge if any color within is low, and a chevron. Tapping expands a resizing panel showing each color's Location + exact quantity, with any low-stock row tinted amber.

---

## 3.4 Design Tokens (Round 7 — precise values, supersedes the general color-role description above)

**Colors (semantic roles, exact hex):**

| Role | Border | Background | Text/Icon |
|---|---|---|---|
| Success / Receive / Positive | `#A9DDB4` | `#E9F6EC` | `#1E7A34` |
| Danger / Low stock / Damaged / Remove | `#F0B4B0` | `#FBEAE9` | `#B23A31` |
| Warning / Pack / New-pending-price | `#F0CD82` | `#FCF3DE` | `#8A6413` |
| Accent / Info / Stock / Ship / Billed | `#AFCBF2` | `#E8F0FC` | `#1F5AA6` |
| Party / Order (purple) | `#D2B4F0` | `#F2EAFB` | `#6B2FA8` |
| Neutral card/border | `#E4E2DE` | `#fff` | `#1C1B19` (primary text) |
| Neutral muted | `#ECEAE6` (dividers) | `#F5F4F1` (section fill) | `#6B6863` (secondary), `#9A968F` (tertiary/meta) |
| Selected chip (any picker) | `#1C1B19` | `#1C1B19` | `#fff` |

**Typography scale:**
- Screen title: 18px/700
- Home greeting: 21px/700
- Eyebrow/label above title: 11–12px/600, muted
- Section-group headers (uppercase): 11.5–12.5px/700, `letter-spacing:0.4px`
- Card title/article name: 13–14px/700
- Body/meta text: 11–13px, muted
- Badge/pill text: 10–10.5px/700
- Button label: 13.5–15px/700
- Stat tile number: 17px/700

**Shape & spacing:**
- Card radius: 12–14px. Pill/chip radius: full (9999px). Button radius: 10–14px. Icon tile radius: 10px.
- Card border: 1px solid neutral border (1.5px on inputs/selects/tab buttons).
- Standard horizontal page margin: 20px.
- Stepper button: 28–30px circle, white fill, shadow-as-border (no visible border line).
- Sticky footer CTA: fades into content via gradient, not a hard divider line.
- Disabled buttons: opacity 0.5.

**Confirm modal:** centered, dark scrim, white card ~300px max-width, 16px radius. Two full-width buttons (Cancel outline / Confirm filled in the action's theme color). Used for every mutation that changes persisted data (save receipt, place order, mark packed, mark shipped) — body copy always names the concrete consequence (e.g. "This updates live stock immediately"), never a generic "are you sure?"

**Toast:** bottom-anchored, dark fill, white text, auto-dismiss ~2.6s, fires after every committed mutation, one at a time.

## 6. Round 6 Refinements (supersede/extend Section 5 where they conflict)

### 5.1 Home — updated
- Only core, frequent, semantically-distinct actions get a colored tile — the grid holds just **Receive Stock (green/Success)** and **Live Stock (blue/Accent)** for now. **New Order (purple)** and **Pack Order (amber)** are confirmed for the same tile treatment once Phase 2 exists — not built until then, captured here for later only.
- Everything else — **Transfer, Manage Users, Set PIN, Factory Payables** — moves into a plain **"More" list** below the colored tiles: icon + label only, no color tint, simple list rows (same treatment the reference gives Transfer/Low Stock/History).
- Owner-only items in that list (**Manage Users, Set PIN, Factory Payables**) still only render for the OWNER role — same conditional-render pattern already used on this screen.

### 5.2 Receive Stock — updated
- Rename the lookup button from "Check" to **"Add"** (two-step flow unchanged: Add to look up, then Add to receipt to commit).
- Article lookup must always offer a **"Change"** action to re-search — never leave a dead-end disabled input after a wrong/failed search.
- New articles: no sizes pre-selected. Show Common row (M/L/XL/XXL) + Extended row (3XL–6XL, always visible) + a "+ add other size" option for S. A **Kids toggle** swaps the whole size section to three fixed, single-select categories instead — 1–5yr (5pc), 6–16yr (6pc), 12–18yr (4pc) — displayed like a set of options where only one can be active at a time, not multi-select chips. For adult sizing, show a live "= N pieces per set" readout that updates as sizes are selected (counting-based). For Kids, the piece count is fixed the moment a category is chosen — no live counting needed, just display that category's set piece count directly.
- **Multiple colours of the same article are staged together** (tick colour, set quantity, repeat) and committed as one group — never single-colour-at-a-time entries.
- Each finalized article entry **snapshots its own Factory, Location, and price** at that moment — not read live from the session-level dropdowns later.
- Add a **"Damaged on arrival"** flag option per item being added.
- The receipt list renders as a **table**, grouped by article, showing Colour / Sets / Pieces per line.
- **"Save receipt" requires a confirmation step** before committing (a centered dialog: "Save this receipt? This updates live stock immediately." Cancel / Confirm).

### 5.3 New Order — updated
- If a searched article number exists under more than one Factory, show **factory-disambiguation chips** before resolving.
- Show pieces alongside sets in both the per-colour picker and the order summary (pieces-per-set is already known from receiving).
- Never show exact stock numbers here — only a "Low stock" badge (see updated threshold below).

### 5.4 Pack Order — updated
- Two views, toggled from the header: **Tally** (flat checklist of all open order lines, for physical counting only — does not change order status) and **Pack List** (the existing grouped-by-order view).
- Low stock after packing: a small red flag/badge only when remaining stock would be **≤2 sets** — never fully tint the card. Don't overstate ordinary shortfalls.
- After Billed, add a **"Mark shipped"** action (order lifecycle is Placed → Packed → Billed → Shipped).

### 5.5 Live Stock View — updated
- Default view is **factory-grouped**: collapsible sections with Factory as the outer layer, Articles nested inside (not simple dropdown filters).
- Top summary shows total sets AND total pieces; each factory section repeats article count / sets / pieces / low-stock count, scoped to that factory.
- Article-level detail collapses behind a dropdown-style row (tap to expand/resize open, chevron rotates) rather than always-visible colour rows.
- Low stock threshold: **≤2 sets = red flag**, consistent with Pack Order and New Order.
- **Within an expanded Article, if its stock spans more than one Location, sub-group by Location first, then Colour within each Location** — not a flat colour-sorted list with location as a per-row column. Each Location becomes its own visible sub-header inside the article. If an article's stock is only at a single Location, this collapses back to the existing flat colour list — no sub-header when there's nothing to disambiguate. Real reported readability problem this fixes: two rows for the same colour name sitting visually adjacent with location as the only distinguishing fact is easy to misread, especially for the near-empty ≤2-set articles common at this project's scale (e.g. article 6023 — 3 colours × 2 locations — was rendering interleaved).

### 5.6 New Screen — History
- Reverse-chronological activity log, grouped by date.
- Each entry: type badge (Received / Order / Packed / Billed / Shipped), timestamp, summary, and "by {user}".
- Every entry has an **Edit** affordance — editing creates a **new correcting entry**, the original stays visible (never overwritten in place).

### 5.7 New Screen — Low Stock List
- A dedicated aggregate view of every article currently at or below the low-stock threshold, so staff/owner don't have to hunt across other screens for this.

### 5.8 New Screen — Factory Payables
- Owner-only screen, own Home tile (same conditional-render pattern as other owner-only tiles) — doesn't depend on any other screen existing.
- A Factory selector (dropdown) at the top is the single source of "which factory am I looking at" — no separate Factory list screen needed.
- Three stat figures below the selector: Total owed and Total paid as two smaller side-by-side stats (neutral background), and Amount payable as the visual hero — larger, full-width, accent-tinted (background + border + text all accent, per §3.1's shared-role rule) — matching how the Owner Dashboard's Stock value KPI already uses accent blue for a computed financial figure (§8).
- Below that, a Payment history list — reverse-chronological, each row showing date, an optional note ("Bank transfer," "Cash"), amount right-aligned.
- Sticky bottom action bar: a single accent-filled "Record payment" button (§3.2's standard pattern).
- Recording a payment uses a lightweight inline PIN prompt, not the standard confirm-modal — the same deliberate exception already established for price edits (§8), extended here because it's a real money-movement action, not because payments are pricing.
- Switching the Factory dropdown must synchronously reset the visible stats/history — no stale numbers from a previous selection should ever remain on screen, same principle already logged for Receive Stock's Factory switch.

### 5.9 Transfer — added 2026-08-13, documented now for the first time
**Provenance note**: Transfer was never in this brief's original §5 screen list — it was an accepted Phase 1 limitation (rule 46) when this document was first written, and the screen that eventually shipped (own Home tile, a flat list of concrete Stock rows scoped to a chosen source Location, no "+ create" affordance — see `Transfer.jsx`'s own header comment and `LEARNING_LOG.md`) followed the app's established conventions rather than a spec written here. This entry documents that existing shape plus a genuinely new addition, staged batching, decided and built on the date above — not backfilled as if either had been specified all along.
- Selecting a Stock row + a quantity **stages it locally** instead of submitting immediately, mirroring Receive Stock/New Order's "Staged batching, precisely" pattern (§7) — pick, set a quantity, repeat, then one commit action pushes the whole group.
- A visible staged list shows every queued line (article, colour, quantity, destination) before commit, growing across any number of different articles — unlike Receive Stock, a Transfer line needs no article-level grouping step, since one Stock row + one quantity + one destination is already a complete, self-contained line.
- Each staged line is individually removable before commit.
- One "Transfer stock" action commits the whole staged batch, submitting each line as its own individual `POST /api/transfers` call, sequentially — a line that succeeds stays committed even if a different line in the same batch fails; failed lines remain staged for retry, never silently dropped.
- Switching the source Location resets the staged list and reloads available stock for the new location, since a staged line's validity is tied to the source it was picked from.
- Each staged line's quantity is capped by that row's real remaining availability — accounting for quantity already staged against the same row in the current batch, not just the raw last-fetched figure.
- Kept the base screen's single confirm modal (not Receive Stock's two-step summary → final) — a Transfer moves stock between the business's own locations without changing the company-wide total, so a mistake is corrected by transferring back, unlike a receipt that invents inventory. That reasoning is unchanged by batching.

## 7. Round 7 Refinements (Claude Design staff prototype)

- **Factory disambiguation copy**: when a searched article number matches more than one Factory, show one chip per match labeled with both factory and article name (e.g. "Round Neck Tee — Jyoti Creations" vs "Kurta Set — Comeco"), not just the bare factory name — the article name itself is often the fastest way for staff to recognize which one they mean.
- **Staged batching, precisely**: both Receive Stock (colors under one article) and New Order (colors under one resolved article) follow the same pattern — pick/check multiple colors, set a quantity for each, then one commit action pushes the whole group at once. After committing, the panel resets so the next article can be searched immediately, without extra navigation.
- **Pack Order card states**: three distinct visual states per line — a check icon (fully packed, neutral card), a warning triangle (short-packed, card gets a warning tint), and a dashed circle (not started, neutral card). Once an order moves past "Placed," packing quantities become read-only/frozen — don't allow edits to a line after packing is locked in.
- **Low Stock screen has no severity tiers** — a row at 0 sets looks the same as a row at 2 sets, both simply flagged. Don't invent extra visual urgency levels beyond the single ≤2 threshold; it adds complexity without real decision value at this scale. Empty state: a single centered muted line ("Nothing is low on stock right now"), no factory headers shown.
- **Correction reason chips**: when editing a History entry, require picking a reason from a fixed set (Miscount, Wrong colour, Wrong customer, Other) before the correction can be confirmed — a single-select chip row, not free text as the primary input (though "Other" can allow a short free-text note).

## 8. Owner Desktop Dashboard (Phase 2 — documented now, NOT built yet)

**Scope note:** depends on Orders existing (Phase 2). This is documented now so it's designed once, correctly, rather than built ad hoc later — but nothing here gets implemented while Phase 1 frontend work is still in progress. It's a desktop-optimized *additional* experience for owner, supplementing — not replacing — the mobile-usable baseline required by rule 15 (owner also checks the app from a phone; this dashboard is for when they're actually at their PC).

### Layout shell
Fixed 240px dark sidebar (logo tile, "Garment Manager"/"Owner" label, nav: Overview/Orders/Low Stock/History, active-row highlight, owner avatar+name pinned to bottom) + main content area, 100vh, only the content pane scrolls. 64px top bar (page title left, today's date right). Same design tokens as the rest of the app (§3.4) — same canvas color, same semantic role colors, no new palette.

### Overview (default landing)
- **KPI row**, 6 cards: Stock value (blue, computed from `costPrice` — inventory cost basis), Sets in stock (neutral), Pieces in stock (neutral), Open orders — Placed+Packed count (purple), Low stock lines — count of stock rows ≤2 sets (red), Revenue from Billed+Shipped orders (green, computed from `sellingPrice` — deliberately a different field than Stock Value, since one is cost and one is what the business actually collects).
- **Widget grid**, independently resizable cards (`resize: both`, each with a sane min-width/height so nothing collapses unusably small):
  - **Stock & Pricing** (largest) — searchable, grouped by article. **Corrected from the original spec: exposes both `costPrice` and `sellingPrice`, not a single price field**, consistent with the two-field pricing model used everywhere else. Each is a click-to-edit control — "Set price" in amber if pending. **Corrected: committing an edit requires a lightweight inline PIN prompt right at the point of edit — not the heavy Cancel/Confirm modal used elsewhere, but not skippable either.** Rows below each article header show (color, location, sets), tinted red at ≤2 sets.
  - **Orders** — one card per order: party, status badge (Placed/Packed/Billed/Shipped, same color coding as everywhere else), line count, value. "Mark billed" button appears only on `packed` orders.
  - **Order value by article** — horizontal bar chart, descending by total order value; unpriced articles show "— price not set" instead of a bar.
  - **Low stock** — compact ≤2-sets list, capped short, full detail lives on the Low Stock page.
  - **Recent activity** — latest 5 History entries, "View all" links to History.

### Orders page
Accordion, one row per order (party, status, line/value summary). Expanded: one line per article/color (ordered vs. packed once applicable) + line value. "Mark billed" only on `packed` orders, **through the standard confirm modal** (this one — unlike price edits — is a real inventory/business-state change, so it keeps the heavy confirm pattern). Writes a History entry authored as the owner.

### Low Stock page
Full, untruncated version of the Overview widget — same red theme, same ≤2 threshold, same "Nothing is low on stock right now" empty state as the staff-facing Low Stock screen (§5.7) — one shared rule, two surfaces.

### History page
Same shared, append-only log the staff app writes to. **Read-only for owner — no correction/edit affordance on this surface**, even though staff's History screen has one. Owner actions (marking billed) write into this same log, authored as the owner.

### Rules carried over unchanged from the staff app (do not deviate)
- `(no, factory)` is still the true article identity — never assume article number alone is unique, same as everywhere else.
- Confirm-modal → toast pattern for every state-changing action **except price edits**, which are the one deliberate exception (lightweight PIN prompt instead, per the correction above).
- Owner does not pack or ship — those stay staff-only (rule 63). Owner's only status transition is packed→billed.
- All monetary values are computed (`sets × piecesPerSet × price`), never hand-entered, except the price field itself.

## 6. What NOT to Do

- Do not use plain scrolling dropdowns where a search/typeahead would reduce friction for long lists (articles especially).
- Do not put movement type, color, or location behind free-text entry — always structured input (dropdown/chip/toggle).
- Do not show cost price anywhere in this screen set.
- Do not show exact stock counts on the New Order screen.
- Do not merge the Receive Stock and New Order flows — they are structurally different (single-location session with manual article entry, vs. Party-first cart-building) and must remain separate screens.
- Do not invent a separate "Edit Order" screen — order adjustments reuse the New Order screen itself.
