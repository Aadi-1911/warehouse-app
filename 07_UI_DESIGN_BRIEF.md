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

- **Screen header**: small rounded-square icon mark (role-tinted background + icon), next to two-line text block — small muted "app name" line above, larger title line below. Present on every screen. **Built as one shared component, `frontend/src/components/ScreenHeader.jsx`, not re-typed per screen** — added 2026-08-13, after all 8 existing screens turned out to have independently hand-copied this exact markup, with nothing enforcing that they'd stay in sync (this section had described the pattern in prose since the brief's first draft, but no component ever actually existed to back it — earlier task prompts referenced "§3.2" assuming otherwise). Every current and future screen should render `<ScreenHeader icon={...} tone="accent|success|warning" eyebrow="Warehouse" title="..." />` rather than writing the icon-mark/eyebrow/title markup inline. It also owns the back-to-Home link: a fixed `<Link to="/">`, always pointing Home, never browser-history/breadcrumb — rendered by default, opted out via `showBackLink={false}` only where going to `/` wouldn't make sense (Home itself has nothing to go back to; Login is unauthenticated and a link to `/` would just bounce back to Login via the route guard).
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
| Danger / Low stock / Damaged / Remove / Bill Orders tile *(added 2026-08-22)* | `#F0B4B0` | `#FBEAE9` | `#B23A31` |
| Warning / Pack / New-pending-price | `#F0CD82` | `#FCF3DE` | `#8A6413` |
| Accent / Info / Stock | `#AFCBF2` | `#E8F0FC` | `#1F5AA6` |
| Party / Order (purple) | `#D2B4F0` | `#F2EAFB` | `#6B2FA8` |
| Teal / Ship *(added 2026-08-22, both roles)* | `#9ED6D0` | `#E6F6F4` | `#146B63` |
| Rust / OWNER Article Pricing tile *(added 2026-08-22)* | `#E8B896` | `#FBF0E8` | `#A85A2E` |
| Lavender / OWNER History tile *(added 2026-08-22)* | `#C7C0D6` | `#F2F0F7` | `#5D5470` |
| Indigo / STAFF Transfer Stock tile *(added 2026-08-22)* | `#A8B4E8` | `#ECEEFB` | `#3D4A9E` |
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

### 5.1 Home — OWNER tile reorganisation, 2026-08-22 (updated same day — see below for what changed after this section's first version)
- OWNER's tile grid is 8 tiles, exact order: **Receive Stock, Article Pricing, New Order, Pack Order, Bill Orders, Ship Order, Live Stock, History.** Article Pricing and History are promoted here from the More list — frequent enough for an owner to earn a tile, per this update. Change PIN, Manage Users and Manage Parties stay in the More list, not tiles.
- Colour fix for the 3-way clash Live Stock/Bill Orders/Ship Order previously shared on Accent blue: **Live Stock keeps Accent. Bill Orders moves to Danger** (§3.4 — reused rather than inventing a colour, closer semantic fit for money-owed than for Ship). **Ship Order gets a Teal token** (§3.4 `--teal-*`) since the palette had only one tone (Danger) free for two tiles needing distinct new colours.
- **Article Pricing is Rust, History is Lavender** (§3.4 `--rust-*`/`--lavender-*`) — both real, genuinely new tones. These two launched this same day on a placeholder neutral tile treatment (no colour specified at the time); once specific colours were requested later the same day, that placeholder was replaced and removed from the codebase as dead code.
- **STAFF's Home screen is no longer fully unaffected by this reorganisation**, a deliberate, confirmed reversal partway through the same day: STAFF's Ship Order tile now uses the same Teal as OWNER's (was Accent, matching Live Stock, at this section's first draft). Everything else about STAFF's screen — Receive Stock, Live Stock, New Order, Pack Order, their order and colours — is still untouched by this reorganisation. (STAFF's tile *set* changes for an unrelated reason — see the Transfer Stock promotion immediately below — but not because of the Bill/Ship/Live-Stock clash this reorganisation exists to fix.)

### 5.1 Home — Transfer Stock promoted to a STAFF-only tile, 2026-08-22 (same day, separate from the OWNER reorganisation above)
- STAFF's tile grid gains a 6th tile, appended at the end: **Receive Stock, Live Stock, New Order, Pack Order, Ship Order, Transfer Stock.** Removed from STAFF's More list accordingly (Transfer stays in OWNER's More list unconditionally — asymmetric handling, the same shape History got when it was promoted the other direction for OWNER above).
- Transfer's tile uses a new **Indigo** token (§3.4 `--indigo-*`), not a reuse of an existing tone. By this point every existing tone was already claimed somewhere across the two role screens; Danger was ruled out (a routine action shouldn't borrow the "something's wrong" tone), and Rust/Lavender were ruled out specifically because those colours already mean Article Pricing/History on OWNER's own Home screen — reusing either for Transfer would make the same colour mean two different things to the owner, who sees both screens.
- OWNER's own tile grid is unaffected by this — still exactly the 8 tiles above, Transfer isn't one of them.

### 5.1 Home — Good Returns row relabelled, 2026-08-22
- The More-list row's label changed from "Good Returns" to **"GR - Goods Return"**. Route, icon, and visibility (any role) are unchanged for both roles.

### 5.1 Home — collapsible "Others" group in OWNER's More list, 2026-08-25 (STAFF unaffected)
- **Manage Users, Set PIN/Change PIN, Manage Parties, and Factory Payables** are pulled out of OWNER's flat More list into one new collapsible group labeled **"Others"**, collapsed by default. Reuses this app's existing nested-accordion convention (chevron toggle, header/body classes — same as Live Stock's Factory→Article groups) rather than a new collapse mechanism.
- Positioned **last** in OWNER's flat list, after Transfer Stock/Low Stock/GR - Goods Return/Owner Dashboard — a judgment call (no order was specified), reading as a settings/admin catch-all tucked at the bottom rather than replacing any one of the four moved items' old position.
- **STAFF's More list is completely unaffected** — Manage Parties (the only one of the four STAFF could see before) still renders as its own flat, immediately-visible row, same position, same behavior. STAFF never sees an "Others" group at all — none of the other three items were ever STAFF-reachable to begin with.

### 5.2 Receive Stock — updated
- Rename the lookup button from "Check" to **"Add"** (two-step flow unchanged: Add to look up, then Add to receipt to commit).
- Article lookup must always offer a **"Change"** action to re-search — never leave a dead-end disabled input after a wrong/failed search.
- New articles: no sizes pre-selected. Show Common row (M/L/XL/XXL) + Extended row (3XL–6XL, always visible) + a "+ add other size" option for S. A **Kids toggle** swaps the whole size section to three fixed, single-select categories instead — 1–5yr (5pc), 6–16yr (6pc), 12–18yr (4pc) — displayed like a set of options where only one can be active at a time, not multi-select chips. For adult sizing, show a live "= N pieces per set" readout that updates as sizes are chosen. For Kids, the piece count is fixed the moment a category is chosen — no live counting needed, just display that category's set piece count directly.
  - **Adult size chips are quantity steppers, not on/off toggles** (amended 2026-08-25, rule 102) — a size can legitimately appear more than once in one set (M, L, L, XL). Every adult chip, on all three rows (Common, Extended, and S once revealed), renders an identical `−` / quantity / `+` stepper **from the moment the sizing step loads** — never revealed only after a size is "selected", and with no special-casing for untouched sizes. The first `+` takes a size from 0 (excluded) to 1 (included), which is the same single tap the previous toggle needed, so nothing gets slower for the common no-repeat article; further taps increment. `−` decrements and is disabled at 0 rather than hidden, so the control never changes shape as it's used. The live readout is the **sum of every chip's quantity**, not a count of non-zero chips. Kids sizing is untouched by this — it stays single-select categories with a fixed piece count.
- **Multiple colours of the same article are staged together** (tick colour, set quantity, repeat) and committed as one group — never single-colour-at-a-time entries.
- Each finalized article entry **snapshots its own Factory, Location, and price** at that moment — not read live from the session-level dropdowns later.
- Add a **"Damaged on arrival"** flag option per item being added.
- The receipt list renders as a **table**, grouped by article, showing Colour / Sets / Pieces per line.
- **"Save receipt" requires a confirmation step** before committing (a centered dialog: "Save this receipt? This updates live stock immediately." Cancel / Confirm).

### 5.2 Receive Stock — color picker is now a live-filtering Combobox, 2026-08-22 (supersedes this same day's earlier search-box-plus-select version)
- The Color field is `components/Combobox.jsx` — one text input, no separate search box next to a picker. Focused with nothing typed, its dropdown shows every available color unfiltered; typing narrows the list live on every keystroke (case-insensitive substring on name), no separate search step. Click or Enter on a row selects it, fills the input with its name, closes the dropdown. Arrow up/down moves a highlighted row through the list; Escape closes without changing the selection; clicking outside does the same.
- "+ Create new color" appears as the LAST row of the same dropdown whenever something's typed (not a separate message block, not gated to only the zero-match case) — one click or Enter creates it using exactly the typed text as the name, selects it, and closes the dropdown. No second name-entry step.
- There is exactly **one** color-picker location on this screen, not two — the picker's own list is already the union of an article's real colors and every system-wide color (the "REAL GAP fix," dated earlier), shared identically by a matched article and a just-created one (both render the same block).
- The already-selected color always stays correctly displayed regardless of what's typed afterward — Combobox's own guarantee, functionally equivalent to (but mechanically different from) the native-`<select>` fix this superseded.
- `Combobox` is a genuinely reusable component, not Receive-Stock-specific — `components/CreatableSelect.jsx` (the native-`<select>` picker Factory/Location still use) is untouched.

### 5.3 New Order — updated
- If a searched article number exists under more than one Factory, show **factory-disambiguation chips** before resolving.
- Show pieces alongside sets in both the per-colour picker and the order summary (pieces-per-set is already known from receiving).
- Never show exact stock numbers here — only a "Low stock" badge (see updated threshold below).
- **Party dropdown behavior** *(added 2026-08-15)*: a row of filter chips sits above the party list — "All", one chip per Party `location` currently in use, plus a trailing "Other" chip for parties with no `location` set. Below the chips, the list itself is grouped by location: one section header per location, parties listed alphabetically within each group, with a trailing "Other" group (also alphabetical within it) for parties with no location. Tapping a chip narrows the visible groups to just that one ("Other" shows only the no-location group); "All" shows every group. The dropdown always opens with "All" selected as the default state.

### 5.4 Pack Order — updated
- ~~Two views, toggled from the header: **Tally** (flat checklist of all open order lines, for physical counting only — does not change order status) and **Pack List** (the existing grouped-by-order view).~~ **DROPPED 2026-08-21, not deferred** — see §5.4 (Pack List)'s 2026-08-19 checklist-first redesign below: its tap-to-confirm, strike-it-off flow plus the per-article/order tally counts on the collapsed accordion header already give the same physical-counting visibility Tally was meant to provide, so the second view was never built.
- Low stock after packing: a small red flag/badge only when remaining stock would be **≤1 set** — never fully tint the card. Don't overstate ordinary shortfalls.
- After Billed, add a **"Mark shipped"** action (order lifecycle is Placed → Packed → Billed → Shipped).

### 5.4 Pack Order (Pack List) — redesigned checklist-first, 2026-08-19
**Supersedes §5.4's original "Packing stepper, editable, defaulting to the ordered quantity" line.** That default meant every line's value already numerically equalled "fully packed" the instant the screen loaded — an untouched line and a confirmed one were indistinguishable, and an untouched line submitted silently at that default. Nothing about the three-state iconography changes (check / warning triangle / dashed circle, §7's own "Pack Order card states" — still accurate); what changes is how a line reaches any state other than dashed.

- A line starts **unconfirmed** — dashed icon, no quantity shown as settled, no stepper visible.
- **Tapping the row's main area** confirms it packed in full at the ordered quantity — one tap for the common case. The row takes the app's existing success-green treatment (tint + struck-through text), matching how "this succeeded" already looks everywhere else. Tapping an already-confirmed row again un-confirms it (recoverable mistap).
- A **separate, smaller "Adjust" control** on the same row — not the same tap target — opens the existing stepper for the less-than-ordered case. Opening it confirms nothing by itself; an explicit **Confirm** inside the panel commits the value, at which point the row takes the existing amber short-pack treatment ("Ordered: X · Only Y in stock" plus the shortfall note) — unchanged from the original spec, only how staff arrives there changed.
- Per-article and order-level tally counts (§101's sticky footer, still present) now read off this same confirmed/unconfirmed state, and the per-article count is shown on the **collapsed** accordion header — visible without expanding every article, the same placement Bill Order already uses for its own blocked-line count.
- **"Mark as packed" with unconfirmed lines remaining**: not a silent submit, and not a hard block. A warning names exactly which article/colour(s) are still unconfirmed, states plainly what proceeding will record for them (packed in full at the ordered quantity), and offers a real choice — go back and finish, or confirm anyway. Same "inform clearly, let the person decide" shape this app already uses for real warnings (e.g. Bill Order's insufficient-stock case).

### 5.5 Live Stock View — updated
- Default view is **factory-grouped**: collapsible sections with Factory as the outer layer, Articles nested inside (not simple dropdown filters).
- Top summary shows total sets AND total pieces; each factory section repeats article count / sets / pieces / low-stock count, scoped to that factory.
- Article-level detail collapses behind a dropdown-style row (tap to expand/resize open, chevron rotates) rather than always-visible colour rows.
- Low stock threshold: **≤1 set = red flag**, consistent with Pack Order and New Order.
- **Within an expanded Article, if its stock spans more than one Location, sub-group by Location first, then Colour within each Location** — not a flat colour-sorted list with location as a per-row column. Each Location becomes its own visible sub-header inside the article. If an article's stock is only at a single Location, this collapses back to the existing flat colour list — no sub-header when there's nothing to disambiguate. Real reported readability problem this fixes: two rows for the same colour name sitting visually adjacent with location as the only distinguishing fact is easy to misread, especially for the near-empty low-stock articles common at this project's scale (e.g. article 6023 — 3 colours × 2 locations — was rendering interleaved).

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

### 5.9 Transfer — updated 2026-08-14: Factory → Article (collapsible) → Colour hierarchy
**Provenance note**: a real screenshot showed the flat Stock-row list above running to ~18 ungrouped rows for a single source Location, unreadable at that length. This is presentation-only — it does not touch which rows are valid or how validity is determined (still every row a real, currently-transferable Stock row, still no "+ create" affordance anywhere on this screen). See `LEARNING_LOG.md` for why this is a genuine amendment to the flat-list reasoning above, not a reversal of it.
- A **Factory dropdown** appears once a source Location is chosen and its stock has loaded, matching Receive Stock's Factory-first pattern (§5.2) — but reversed in order (Location first, then Factory) since Location is already this screen's own session-level starting point, not Factory.
- The Factory dropdown's own options are drawn from the Factories actually present in the already-fetched, already-transferable rows at that Location — never a separately-fetched full Factory list — so every option shown is guaranteed to produce a non-empty result once picked.
- Below the Factory dropdown, rows are grouped by **Article**, shown as a collapsible accordion matching Live Stock's pattern (§3.2, §5.5) — collapsed by default, header shows the Article No + a colour-count badge + a chevron.
- **Colour rows nest inside each expanded Article**, each still showing its own available quantity and feeding the exact same selection/stepper/staging mechanism the flat list always used — picking a nested colour row is still just picking one Stock row.
- An Article with only a single valid Colour renders as a plain row directly, with no accordion wrapper — collapsing a single item behind a header and a chevron is friction with nothing to disambiguate, the same reasoning already applied to Live Stock's single-Location collapse (§5.5).
- The existing search box is unaffected and still searches article/colour text across the whole Location regardless of which Factory is selected — a search term is already a more direct way to find one specific row, so it bypasses Factory/Article grouping entirely rather than being scoped by it.
- Switching Factory resets the visible Article list (collapses every expanded section) and clears any in-progress row selection — mirroring how switching the source Location already resets the whole screen — but does **not** clear the staged list, since a staged line's validity is tied to the source Location it was picked from, not to which Factory is currently being browsed.
- Staged batching, per-line submission, and the in-flight-submission guard (§5.9's earlier entry above) are entirely unchanged — this amendment only changes how a row gets *selected*.

### 5.10 New Screen — Article Pricing
- Owner-only, added to Home's "More" list (per 5.1's updated tile hierarchy) — not a primary colored tile, since price-setting isn't a daily action.
- A Factory selector (dropdown) at the top, same pattern as Factory Payables.
- Below it, a flat matrix table of every article under the selected Factory: columns S.No. (row index, not a real id), Name, Article No, Cost Price, Selling Price, Margin (Selling − Cost, computed, not stored).
- Any article with no price set yet renders its Cost/Selling/Margin cells with the existing "pending price" badge treatment instead of blank cells, and pending-price rows sort to the top of the table — this screen is the direct fix for a real gap (no UI existed anywhere to resolve a pending-price article after receiving).
- Each row has an Edit action that opens the same lightweight inline PIN-prompt pattern already used for Factory Payables' Record Payment (not a modal) — pre-filled with that row's current Cost/Selling price, PIN required to save, matching the existing non-negotiable rule that price edits require OWNER role AND PIN regardless of when they happen.
- This screen is the second real user of that lightweight inline-PIN pattern, same as Factory Payables was the first.

## 7. Round 7 Refinements (Claude Design staff prototype)

- **Factory disambiguation copy**: when a searched article number matches more than one Factory, show one chip per match labeled with both factory and article name (e.g. "Round Neck Tee — Jyoti Creations" vs "Kurta Set — Comeco"), not just the bare factory name — the article name itself is often the fastest way for staff to recognize which one they mean.
- **Staged batching, precisely**: both Receive Stock (colors under one article) and New Order (colors under one resolved article) follow the same pattern — pick/check multiple colors, set a quantity for each, then one commit action pushes the whole group at once. After committing, the panel resets so the next article can be searched immediately, without extra navigation.
- **Pack Order card states**: three distinct visual states per line — a check icon (fully packed, neutral card), a warning triangle (short-packed, card gets a warning tint), and a dashed circle (not started, neutral card). Once an order moves past "Placed," packing quantities become read-only/frozen — don't allow edits to a line after packing is locked in.
- **Low Stock screen has no severity tiers** — a row at 0 sets looks the same as a row at 1 set, both simply flagged. Don't invent extra visual urgency levels beyond the single ≤1 threshold; it adds complexity without real decision value at this scale. Empty state: a single centered muted line ("Nothing is low on stock right now"), no factory headers shown.
- **Correction reason chips**: when editing a History entry, require picking a reason from a fixed set (Miscount, Wrong colour, Wrong customer, Other) before the correction can be confirmed — a single-select chip row, not free text as the primary input (though "Other" can allow a short free-text note).

## 8. Owner Desktop Dashboard (Phase 2 — documented now, NOT built yet)

**Scope note:** depends on Orders existing (Phase 2). This is documented now so it's designed once, correctly, rather than built ad hoc later — but nothing here gets implemented while Phase 1 frontend work is still in progress. It's a desktop-optimized *additional* experience for owner, supplementing — not replacing — the mobile-usable baseline required by rule 15 (owner also checks the app from a phone; this dashboard is for when they're actually at their PC).

### Layout shell
Fixed 240px dark sidebar (logo tile, "Garment Manager"/"Owner" label, nav: Overview/Orders/Low Stock/History/Parties, active-row highlight, owner avatar+name pinned to bottom) + main content area, 100vh, only the content pane scrolls. 64px top bar (page title left, today's date right). Same design tokens as the rest of the app (§3.4) — same canvas color, same semantic role colors, no new palette.

### Overview (default landing)
- **KPI row**, 6 cards: Stock value (blue, computed from `costPrice` — inventory cost basis), Sets in stock (neutral), Pieces in stock (neutral), Open orders — Placed+Packed count (purple), Low stock lines — count of stock rows ≤1 set (red), Revenue from Billed+Shipped orders (green, computed from `sellingPrice` — deliberately a different field than Stock Value, since one is cost and one is what the business actually collects).
- **Widget grid**, independently resizable cards (`resize: both`, each with a sane min-width/height so nothing collapses unusably small):
  - **Stock & Pricing** (largest) — searchable, grouped by article. **Corrected from the original spec: exposes both `costPrice` and `sellingPrice`, not a single price field**, consistent with the two-field pricing model used everywhere else. Each is a click-to-edit control — "Set price" in amber if pending. **Corrected: committing an edit requires a lightweight inline PIN prompt right at the point of edit — not the heavy Cancel/Confirm modal used elsewhere, but not skippable either.** Rows below each article header show (color, location, sets), tinted red at ≤1 set.
  - **Orders** — one card per order: party, status badge (Placed/Packed/Billed/Shipped, same color coding as everywhere else), line count, value. "Mark billed" button appears only on `packed` orders.
  - **Order value by article** — horizontal bar chart, descending by total order value; unpriced articles show "— price not set" instead of a bar.
  - **Low stock** — compact ≤1-set list, capped short, full detail lives on the Low Stock page.
  - **Recent activity** — latest 5 History entries, "View all" links to History.

### Orders page
Accordion, one row per order (party, status, line/value summary). Expanded: one line per article/color (ordered vs. packed once applicable) + line value. "Mark billed" only on `packed` orders, **through the standard confirm modal** (this one — unlike price edits — is a real inventory/business-state change, so it keeps the heavy confirm pattern). Writes a History entry authored as the owner.

### Low Stock page
Full, untruncated version of the Overview widget — same red theme, same ≤1 threshold, same "Nothing is low on stock right now" empty state as the staff-facing Low Stock screen (§5.7) — one shared rule, two surfaces.

### History page
Same shared, append-only log the staff app writes to. **Read-only for owner — no correction/edit affordance on this surface**, even though staff's History screen has one. Owner actions (marking billed) write into this same log, authored as the owner.

### Parties page *(added 2026-08-15 — designed now, not buildable yet; layout superseded 2026-08-28)*
**Dependency note:** this subsection depends on `Order`/`OrderLineItem` existing (Phase 2 core, not yet built) for its content, and on the Dashboard shell itself existing (also not yet built, see "Layout shell" above) as its container. It's documented now so the design doesn't need re-litigating later, but it should not be scheduled before both dependencies land.
- **Single-column layout** *(2026-08-28, replacing the original master-detail grid below)*: with only a couple of parties in real use, a fixed left-column list of cards read as mostly wasted space and doesn't scale as a browse surface once there are dozens of parties either — a search-first control does the same job (find a party, see who's selected) in the footprint of one line, freeing the full page width for Sales Summary/Party Payables instead of a cramped right column.
  - **Two separate, always-mounted pieces** *(revised same day, 2026-08-28, after direct feedback on the first version below)*: **PartySearchBar** — a plain lookup input, always present at the top, filtering by **name only** with a dropdown of matches. Picking a party calls the selection handler and the search box clears itself back to empty, ready for the next search — it is a lookup tool, not a display of the current pick. **PartyInfoBox** — a constant, always-visible line directly below it showing the selected party's **Name (bold, no label), Address:, GST: (with the copy-to-clipboard button), and Phone number:**, each field with an explicit label, spread evenly across the full width (not clustered left). It is plain display, never a button and never becomes an input — typing in the search bar above has no effect on it except through an eventual selection. (First version combined these into one element that switched from a display line into a search input on click; Aadi's direct feedback on the live result was that the two needed to be genuinely separate elements, not one control changing modes.)
  - The old separate header (avatar-initials + name + location) and Contact block (phone/full address/GSTIN) are both gone, not just the list — once PartyInfoBox carries Name/Address/GSTIN/Phone, either block would just repeat a field already shown there. The copy-to-clipboard behavior itself is unchanged: copies just the GSTIN number, shows a brief checkmark confirmation.
  - **Sales summary** section: four preset chips (This month / Last 6 months / This FY / All time) plus a free-form From/To month picker — both driven by the same underlying calculation (rule 98).
  - **Orders and bills** list below that: date, status pill using the existing order-status color mapping, value. Empty state: "No orders yet." until Order data exists.
- **Mobile gap, explicitly not solved here**: this pattern (a full detail area appearing on selection) is desktop-only per rule 15 — mobile needs push-navigation to a full detail screen instead. This is a real, known gap that still needs its own design pass when responsive/mobile Owner Dashboard work happens; no mobile version is invented here.
- **Original master-detail layout, kept for the record (superseded 2026-08-28, not current):** a grid of party cards on the left (rectangular, name + location, tap/click to select), with a header (avatar-initials + name + location) and a separate Contact block (phone/full address/GSTIN) stacked at the top of the right-hand detail panel.

### Article Pricing page *(added 2026-08-21, beyond §8's original 5-item nav — same precedent as Locations)*
A genuine desktop grid — a real sortable `<table>`, not the mobile screen ported over. Fetches every active article across every Factory in one call (no factory pre-filter the way mobile requires); Factory is a real, sortable column instead, since a desktop owner would rather sort/scan than be forced through a picker first. Reuses `GET /api/products` (role-aware costPrice) and `PATCH /api/products/:id` (OWNER+PIN the moment costPrice/sellingPrice appear in the body) — no parallel price-write path.
- **Columns, all independently sortable by clicking the header**: Article No, Name, Factory, Cost Price, Selling Price, Margin. Default order (before any header is clicked) is pending-first then Article No — once a column IS clicked, that explicit choice is respected literally, no hidden pending-first tie-break riding along.
- **Pending articles (rule 8) are included, not filtered out** — this page is specifically an owner pricing-management tool, and a pending article is exactly the kind of row it exists to surface.
- **Type is noticeably larger than the dashboard's other pages** — an explicit ask (readable at a glance on a big screen), not just "consistent with the existing dashboard type scale."
- **Inline edit per row, PIN-gated**: Cost/Selling Price cells become real input fields in place; committing swaps to the shared `PinPrompt` component (the same lightweight-PIN-at-commit shape rule 71 already requires everywhere else), not a fourth hand-copied inline PIN form.
- Archive/reactivate is deliberately **not** part of this page — that's mobile Article Pricing's own separate concern, not duplicated here.

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
