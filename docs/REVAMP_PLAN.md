# UI Revamp + Responsiveness Plan

Written 2026-09-30 on branch `add-location-pricing-ui-f3` at `026b5a3`, as a read-only planning task. Sections 0–6 and the stale-docs list are copied verbatim from that session's plan. File links are relative to the repository root, not to this `docs/` folder. The owner's decisions on the plan follow at the end.

## 0. Setup checks (raw output)

```
$ git branch --show-current
add-location-pricing-ui-f3

$ git rev-parse --short HEAD
026b5a3

$ git status --short
(Bash completed with no output)
```

All three match what you expected.

---

## 1. Inventory

### Mobile Bill Order page — [BillOrderDetail.jsx](frontend/src/pages/BillOrderDetail.jsx)
You reach it from Home → Bill Orders tile → tap an order (2 taps).

| Element | Lines | When it shows | Clicks to reach |
|---|---|---|---|
| Header, party name, "Packed" badge | [L510-512](frontend/src/pages/BillOrderDetail.jsx#L510-L512) | Always | 0 |
| "Can no longer be billed" state | [L394-406](frontend/src/pages/BillOrderDetail.jsx#L394-L406) | Order isn't PACKED | 0 |
| Submit / cancel error banners | [L514-524](frontend/src/pages/BillOrderDetail.jsx#L514-L524) | After a failure | 0 |
| One collapsible header per article: article no, name, **total** | [L531-556](frontend/src/pages/BillOrderDetail.jsx#L531-L556) | Always, collapsed | 0 |
| ↳ The article total uses **`priceAtOrder`** (the quote) | [L422](frontend/src/pages/BillOrderDetail.jsx#L422) | Always | 0 — **this is the ₹2,000 vs ₹2,080 bug** |
| ↳ "N can't be billed" badge | [L547-553](frontend/src/pages/BillOrderDetail.jsx#L547-L553) | Stock is short | 0 |
| Colour lines: sets, "(of N ordered)", blocked note, "Cancel this line" | [L558-606](frontend/src/pages/BillOrderDetail.jsx#L558-L606) | Article expanded | +1 per article |
| Sticky bar: tally, blocked note, **Bill this order**, Cancel this order | [L613-664](frontend/src/pages/BillOrderDetail.jsx#L613-L664) | Always | 0 |
| Cancel line/order confirm | [L666-678](frontend/src/pages/BillOrderDetail.jsx#L666-L678) | Cancel tapped | 1 |
| **Bill dialog** (a 300px `ConfirmModal`) | [L688-874](frontend/src/pages/BillOrderDetail.jsx#L688-L874) | "Bill this order" | 1 |
| ↳ Order total, plus "(estimate at your new prices)" | [L713-728](frontend/src/pages/BillOrderDetail.jsx#L713-L728) | Once the preview loads | 1 |
| ↳ Location picker (`BillFulfillmentPicker`) | [L733-742](frontend/src/pages/BillOrderDetail.jsx#L733-L742) | Always | 1 |
| ↳ Price review (`BillPriceReview`) | [L750-759](frontend/src/pages/BillOrderDetail.jsx#L750-L759) | Once the preview is ready | 1 |
| ↳ "Prices changed while you were reviewing" note (after a 409) | [L761-765](frontend/src/pages/BillOrderDetail.jsx#L761-L765) | After a 409 PRICES_CHANGED | — |
| ↳ **PIN step**: "N prices changed — enter your PIN…", PinPrompt, "Change prices" | [L774-791](frontend/src/pages/BillOrderDetail.jsx#L774-L791) | After "Review changes & enter PIN" | 3+. It appears **above** the discount/GST fields, far from the button that opened it |
| ↳ Discount checkbox → % field → "−₹X discount" line | [L794-821](frontend/src/pages/BillOrderDetail.jsx#L794-L821) | Box ticked | +1 |
| ↳ GST checkbox → % field → **"+₹801.9 GST"** line | [L823-842](frontend/src/pages/BillOrderDetail.jsx#L823-L842) | Box ticked | +1 — L842 uses `formatCurrency`, which has no minimum decimals |
| ↳ Rounding line (already 2 decimals) | [L849-853](frontend/src/pages/BillOrderDetail.jsx#L849-L853) | Rounding ≠ 0 | — |
| ↳ **Total to bill** (never labelled an estimate) | [L855](frontend/src/pages/BillOrderDetail.jsx#L855) | Always | 1 |
| ↳ Bill No. (optional) | [L862-872](frontend/src/pages/BillOrderDetail.jsx#L862-L872) | Always — **mobile only** | 1 |

### Desktop Mark-billed dialog — [dashboard/Orders.jsx](frontend/src/pages/dashboard/Orders.jsx)
You reach it from Dashboard → PIN unlock → Orders → "Mark billed" on a row ([L477-508](frontend/src/pages/dashboard/Orders.jsx#L477-L508)). The dialog is [L799-967](frontend/src/pages/dashboard/Orders.jsx#L799-L967) and has the same elements in the same order as mobile. The differences:
- **No Bill No. field.**
- No up-front stock check or blocked lines, and no cancel line/order.
- The dialog text says "deducts real stock" instead of naming the number of sets.
- The stale-price note ends "mark billed again" instead of "bill again".
- It uses the same 300px card ([index.css:1666](frontend/src/index.css#L1666)), which is why it looks phone-sized on a desktop.

### Location picker — [BillFulfillmentPicker.jsx](frontend/src/components/BillFulfillmentPicker.jsx)
- "Fulfil from" location buttons: [L132-168](frontend/src/components/BillFulfillmentPicker.jsx#L132-L168). Switching location clears the tick and resets typed prices ([L152-161](frontend/src/components/BillFulfillmentPicker.jsx#L152-L161)).
- "Can't cover" banner: [L183-188](frontend/src/components/BillFulfillmentPicker.jsx#L183-L188).
- Per-article groups start **collapsed** ([L190-255](frontend/src/components/BillFulfillmentPicker.jsx#L190-L255)). The per-line "need · InStock · ₹/piece" detail only shows after you tap each article. So on a 3-article order, checking every price costs 3 extra taps.
- Confirmation tick: [L277-280](frontend/src/components/BillFulfillmentPicker.jsx#L277-L280).

### Price review — [BillPriceReview.jsx](frontend/src/components/BillPriceReview.jsx)
- Heading "Prices OK, or change?": [L32](frontend/src/components/BillPriceReview.jsx#L32).
- Reset note: [L38-42](frontend/src/components/BillPriceReview.jsx#L38-L42).
- One row per article: name, baseline price, input ([L44-83](frontend/src/components/BillPriceReview.jsx#L44-L83)). **Each article is listed a second time** in the same dialog, once here and once in the picker.
- Error line: [L85-89](frontend/src/components/BillPriceReview.jsx#L85-L89).
- **"(replaces both prices above)"**: [L94](frontend/src/components/BillPriceReview.jsx#L94). It says "both" even when there are 3 or more prices.
- Below-cost warning: [L101-106](frontend/src/components/BillPriceReview.jsx#L101-L106).
- "N prices changed for this bill only" summary: [L114-135](frontend/src/components/BillPriceReview.jsx#L114-L135). Together with BillOrderDetail's own line at [L776-780](frontend/src/pages/BillOrderDetail.jsx#L776-L780), this is almost certainly the **"shown twice"** PIN message. Orders.jsx has the same pair at [L887-891](frontend/src/pages/dashboard/Orders.jsx#L887-L891).
- A note appears only while cost prices are **loading** ([L141-143](frontend/src/components/BillPriceReview.jsx#L141-L143)). If the cost lookup fails, nothing is shown. `useOwnerCostPrices` does return `error`, but both screens ignore it ([BillOrderDetail.jsx:129](frontend/src/pages/BillOrderDetail.jsx#L129), [Orders.jsx:216](frontend/src/pages/dashboard/Orders.jsx#L216)).

### PinPrompt and ConfirmModal
- **PinPrompt** ([PinPrompt.jsx:61-88](frontend/src/components/PinPrompt.jsx#L61-L88)) is a PIN field, an error line with "(N attempts remaining)", and a full-width submit button. It works the same on phone and desktop. It has its own `<form>`, so it can't sit inside a bigger form.
- **ConfirmModal** ([ConfirmModal.jsx:48-68](frontend/src/components/ConfirmModal.jsx#L48-L68)) is a dark backdrop with a card capped at 300px wide and 90% of screen height ([index.css:1661-1669](frontend/src/index.css#L1661-L1669)). It has a title, body text, optional extra content, Cancel, and a Confirm button that can be hidden. There's no wide version — it's the same 300px card on every screen.

### Mobile Article Pricing — [ArticlePricing.jsx](frontend/src/pages/ArticlePricing.jsx)
- Factory dropdown: [L437-451](frontend/src/pages/ArticlePricing.jsx#L437-L451).
- Success banner and empty states: [L453-476](frontend/src/pages/ArticlePricing.jsx#L453-L476).
- "Show archived": [L484-491](frontend/src/pages/ArticlePricing.jsx#L484-L491).
- **Main table, 7 columns** ([L498-690](frontend/src/pages/ArticlePricing.jsx#L498-L690)). Every header and cell is `white-space: nowrap` ([index.css:1476](frontend/src/index.css#L1476), [1482](frontend/src/index.css#L1482)). That's why it **scrolls sideways**, and Margin/Edit end up off-screen at 375px.
- "Per-location pricing" badge: [L532-534](frontend/src/pages/ArticlePricing.jsx#L532-L534).
- **Read-only per-location sub-table**: [L619-684](frontend/src/pages/ArticlePricing.jsx#L619-L684).
- **Misaligned headers:** `.pricing-location-table th { text-align:left }` ([index.css:1549-1550](frontend/src/index.css#L1549-L1550)) outranks `.pricing-table-num` ([index.css:1505](frontend/src/index.css#L1505)) in the CSS. So headers sit left while their values sit right. The main table has the same problem ([index.css:1467-1468](frontend/src/index.css#L1467-L1468)). The desktop tables already fixed this at [index.css:4660](frontend/src/index.css#L4660).
- Edit / Rename / Archive links: [L581-607](frontend/src/pages/ArticlePricing.jsx#L581-L607). There's no disabled styling for these links anywhere in the CSS; `.link-button` ([index.css:922-933](frontend/src/index.css#L922-L933)) has no `:disabled` rule.
- The Rename card ([L706-747](frontend/src/pages/ArticlePricing.jsx#L706-L747)) and the **Edit-price card with its own hand-built PIN field** ([L749-815](frontend/src/pages/ArticlePricing.jsx#L749-L815)) open **below the whole table**. On a phone, tapping Edit on row 1 opens a form off-screen.
- Archive confirm: [L822-846](frontend/src/pages/ArticlePricing.jsx#L822-L846).

### Desktop Article Pricing — [dashboard/ArticlePricing.jsx](frontend/src/pages/dashboard/ArticlePricing.jsx)
- Success banner and "set your PIN" banner: [L500-514](frontend/src/pages/dashboard/ArticlePricing.jsx#L500-L514).
- Factory sections, collapsed (+1 click each): [L522-541](frontend/src/pages/dashboard/ArticlePricing.jsx#L522-L541).
- Main table: [L546-1059](frontend/src/pages/dashboard/ArticlePricing.jsx#L546-L1059).
- Inline cost/selling edit: [L621-649](frontend/src/pages/dashboard/ArticlePricing.jsx#L621-L649).
- Action cell with Edit, Rename and the "Different price per location" toggle: [L699-779](frontend/src/pages/dashboard/ArticlePricing.jsx#L699-L779).
- Base-price PIN row: [L816-838](frontend/src/pages/dashboard/ArticlePricing.jsx#L816-L838).
- Location sub-table: [L845-1053](frontend/src/pages/dashboard/ArticlePricing.jsx#L845-L1053).
- Location edit (Continue / Use base price / Cancel): [L962-999](frontend/src/pages/dashboard/ArticlePricing.jsx#L962-L999).
- Location PIN row: [L1012-1045](frontend/src/pages/dashboard/ArticlePricing.jsx#L1012-L1045).
- **"Change detailsCancel"**: two link-buttons sit side by side with no spacing wrapper, at [L1029-1042](frontend/src/pages/dashboard/ArticlePricing.jsx#L1029-L1042) and again at [L830-835](frontend/src/pages/dashboard/ArticlePricing.jsx#L830-L835).
- **"₹-50"**: `computeMargin` passes a negative number to `formatCurrency` ([margin.js:44](frontend/src/utils/margin.js#L44)). Every screen has its own local copy of `formatCurrency`, all written the same way (e.g. [BillOrderDetail.jsx:46-48](frontend/src/pages/BillOrderDetail.jsx#L46-L48)).

---

## 2. Responsiveness audit

**Mobile app (`pages/*`).** Every screen sits inside `.page`, which is capped at 480px ([index.css:414-418](frontend/src/index.css#L414-L418)). The only media query in the whole stylesheet is the dashboard one at [index.css:4939](frontend/src/index.css#L4939).

| Screen | ~375px | ~1280px |
|---|---|---|
| Home, Login, SetPin, LiveStock, LowStockList, Transfer, ManageUsers, Parties, NewOrder, Pack/Bill/Ship lists and details, History, GoodReturns | ✓ Built for phone. No tables or fixed-width grids found. | Works, but as a 480px centred column (verify) |
| ReceiveStock | ✓ 3-column receipt table ([L1933](frontend/src/pages/ReceiveStock.jsx#L1933)) fits | 480 column |
| FactoryPayables (mobile) | ✓ | 480 column |
| **ArticlePricing** | ✗ Sideways scroll and misaligned headers (see §1) | 480 column, still cramped |
| **BillOrderDetail dialog** | Works but crowded (300px card) | ✗ 300px dialog on a big screen |

**Owner Dashboard (`pages/dashboard/*`)**

| Screen | ~375px | ~1280px | Cause |
|---|---|---|---|
| **Layout shell** | ✗ The side menu shrinks to a 58px icon strip, leaving ~285px for content. **"Back to the app" is hidden**, so on narrow widths the dashboard is a one-way door. | ✓ | [index.css:4939-4953](frontend/src/index.css#L4939-L4953), specifically [4946](frontend/src/index.css#L4946) |
| Overview | ✗ The 8 KPI cards stay in 4 columns (~60px each). Activity rows reserve 282px of fixed-width columns, leaving no room for the text. | ✓ | [3551-3554](frontend/src/index.css#L3551-L3554), [3837-3864](frontend/src/index.css#L3837-L3864) |
| Orders | ◐ The Mark-billed button (at least 88px wide) squeezes the party name | ✗ 300px dialog | [909](frontend/src/index.css#L909), [1666](frontend/src/index.css#L1666) |
| History | ✗ Single-line rows where badge, party, time and "Correct" can't shrink, so the description shrinks to nothing | ✓ | [3128-3154](frontend/src/index.css#L3128-L3154) |
| Locations | ✗ Stays at 3 KPI columns and 3 donut columns. The popover is a fixed 320px, wider than the space. | ✓ | [3735](frontend/src/index.css#L3735), [3747](frontend/src/index.css#L3747), [4528](frontend/src/index.css#L4528) |
| Article Pricing | ✗ Sideways scroll. The action cell (Edit, Rename, toggle label, no wrapping) is very wide. | ✓ | [4744](frontend/src/index.css#L4744), `.table-scroll` |
| Bills | ✗ Controls row doesn't wrap and each dropdown is at least 160px, so it overflows. The table scrolls sideways. | ✓ | [4924-4933](frontend/src/index.css#L4924-L4933) |
| Factories | ✗ Table scrolls sideways | ✓ | `.table-scroll` |
| Parties | ◐ Info line and chips wrap. Probably OK apart from the shell (verify). | ✓ | — |
| Low Stock, Live Stock | ◐ Collapsible sections in cards. Probably OK apart from the shell (verify). | ✓ | — |
| Factory Payables (in dashboard) | ✓ apart from the shell | ◐ Phone-shaped cards stretched to full width | [FactoryPayables.jsx:849](frontend/src/pages/FactoryPayables.jsx#L849) |

**Shared causes — each fix repairs several screens at once:**
1. **The dashboard shell has no phone layout, and "Back to the app" disappears.** Fixing this helps all 11 dashboard pages.
2. **Tables have no phone layout.** Affects Article Pricing (both), Bills and Factories.
3. **The dialog has one size, 300px.** Affects both billing screens and would help any future complex dialog.
4. **Grids have fixed column counts and never drop to fewer columns.** Affects Overview, Locations and Bills controls.
5. **Single-line rows that refuse to wrap.** Affects History and Overview activity.
6. **CSS ordering bug that pushes number-column headers left.** Affects both mobile pricing tables.
7. **`.link-button` has no disabled style and no spacing wrapper for groups.** Affects both pricing screens.
8. **Money formatting is copied into each screen**, with no fixed decimal places and no handling of negative numbers. Affects every screen that shows ₹.

---

## 3. Must not change

- **Billing math and rounding display.** Keep `computeBillingAmounts` exactly as written (same order of operations as the server), `Math.round`, the Rounding line's `toFixed(2)`, the rule that "Order total" only uses the client estimate when `pinRequired`, and `clampPercent`.
- **Location switching.** Switching clears the tick and typed prices (picker [L152-161](frontend/src/components/BillFulfillmentPicker.jsx#L152-L161), `handleLocationSwitched`). Keep `resetPriceAndLocationReview` on open, on cancel, and on any non-PIN failure. Keep `refetchPreview()` on open.
- **PIN only when a price changed** (`pricing.pinRequired`). PinPrompt *replaces* the confirm button (`hideConfirm`). Keep the `billingInputIncomplete` re-check inside `handleConfirmBill`, and the price inputs locked while the PIN step is open.
- **What gets sent.** `seenPrices` is built from the rendered preview on every bill. `priceOverrides` includes only articles that actually changed.
- **409 PRICES_CHANGED:** keep the dialog open, keep typed prices, drop back out of the PIN step, refetch. PIN errors fall through to PinPrompt.
- **PIN on every location-price write** (a flat `{sellingPrice, pin}` body). The per-location toggle stays OWNER-only with no PIN. Only one row is edited at a time.
- **STAFF never sees cost:** keep the client-side `user.role === 'OWNER'` checks; the server already enforces it.
- The existing index.css tokens, the ≤1-set low-stock threshold, Margin % as a whole number, the archive stock check, and **all backend code**. Nothing in this plan needs an API change: `setLocationPrice` and `setLocationPricingEnabled` already exist in [api/products.js](frontend/src/api/products.js).

---

## 4. Proposal

### Shared building blocks (built first)
- **B1 `utils/money.js`** — one formatter that always shows a leading "−" for negatives ("−₹50") and has a 2-decimal mode ("+₹801.90"). It replaces the local copies one screen at a time. `computeMargin` already takes the formatter as a parameter, so fixing the formatter fixes margins everywhere.
- **B2 CSS primitives, using existing tokens only:**
  - `.link-button:disabled` at opacity 0.5 (the brief's own disabled value).
  - `.action-row`: a flex row with `var(--space-4)` spacing that wraps.
  - A fix for the number-column header ordering bug.
  - Two breakpoints used consistently: **640px** (phone) and **900px** (the existing one).
- **B3 `ConfirmModal size="wide"`.** Existing callers are unaffected.
  - Below 900px it becomes a full-screen sheet with a pinned footer (`100dvh`, the existing `--card-bg`).
  - At 900px and above it's a centred dialog about 1040px wide, 16px corners, same backdrop.
  - The action buttons live in the pinned footer. When the PIN step starts, **PinPrompt appears in that same footer slot**.
- **B4 `BillReviewPanel`.** A display-only component used by both billing screens. It lays out the existing controls and computes nothing itself; all numbers still come from `deriveBillPricing`.
- **B5 `LocationPriceRows`** plus a shared `parseLocationSellingPrice`. It contains the edit → stage → PinPrompt steps for location prices and is used by **both** pricing screens.
- **B6 Dashboard shell below 640px.** A top bar showing the title, a Menu button that opens a slide-out nav, the Lock button, and **"Back to the app" always visible**.

### Bill panel — one layout, both screens
Elements always appear in the same order. On desktop the two columns sit side by side; on a phone they stack in the same order.

```
Left: what leaves the building           Right: what they pay
1 Fulfil from [GGN][Delhi]                5 Order total ₹16,038.00 (estimate at new prices)
2 One row per article:                    6 Changed prices: 6023 ₹2,000 → ₹1,950 (only if any)
  ✓ 6023 Round Neck · 8 sets              7 ☐ Discount  [ %]  −₹801.90
  ₹2,080/pc [new price] = ₹16,640         8 ☐ GST       [ %]  +₹801.90
  ▸ colours (need/in stock)               9 Rounding +₹0.10
3 ☐ I've confirmed this location          10 Total to bill ₹16,838 (estimate)
                                          11 Bill No. (optional) — on desktop too
FOOTER (pinned): "Deducts 8 sets and locks the order — can't be undone."   [Cancel] [Bill and lock order]
PIN step, same footer slot:  [PIN ____] [Bill and lock order]  Change prices · Cancel
```

- **Always visible:** 1, the article rows (2), 3, 5, 7–11, and the footer.
- **Collapsed:** only the per-colour detail. Articles that are short on stock open automatically.
- **Merging the lists:** BillFulfillmentPicker's article groups and BillPriceReview's rows become **one** list, so each article appears once.
- **Wording:** "(replaces both prices)" becomes "(replaces all 3 prices above)". The duplicate PIN sentence is dropped, keeping only the changed-prices summary (6). "(estimate)" is added to Total to bill when `pinRequired`. "Couldn't check cost prices — below-cost warnings are off" appears when the cost lookup fails.
- **Mobile Bill Order page:** keeps the order review and cancel-line actions. The article-header money changes according to **Q1**.
- **Dashboard Orders on a phone:** the row header stacks, so Mark billed drops below the party line.

### Article Pricing — one design language, both screens
- **Phone** (the mobile screen, and the dashboard below 640px): one card per article, no table.

  ```
  6023 · Round Neck Tee
  Cost ₹1,500   Selling ₹2,000   Margin ₹500 · 25%
  Edit price · Rename · Archive          (.action-row)
  ☐ Different price per location
    Delhi    ₹2,080   ₹580 · 28%   Edit
    Gurgaon  ₹2,000   ₹500 · 25%   Edit
  ```

  Tapping a location's **Edit** expands the form **right under that row**: price input, then Continue · Use base price · Cancel. Next comes a sentence stating what's being set, then **PinPrompt**, then Change details · Cancel. **This is where the owner sets or clears a location price from a phone**, with a PIN on every save.

  The base-price Edit and Rename forms also open in place under the card instead of below the whole table.
- **Desktop:** keeps the table, with the same row → location sub-rows structure, the same action labels, the same inline expansion, the header fix, and `.action-row` spacing.
- **STAFF:** the route is already OWNER-only, and the cost/margin columns stay behind `user.role === 'OWNER'`.

### Click counts (current → proposed)

| Task | Current | Proposed |
|---|---|---|
| Plain bill (from order page or Orders row) | 3 (open, tick, Bill). Plus 1 per article to *see* the prices. | 3, with prices visible without expanding |
| Price-change bill | 4, plus typing. The PIN field appears above discount/GST, away from the button. | 4, and the PIN field appears where the button was |
| Discount + GST bill | 5, plus typing | 5 (unchanged — the ticks are the "applicable" answers the server needs) |
| Set a location price, desktop | Article Pricing, expand factory, [toggle], Edit, Continue, Save = 5–6 | 5–6, same labels as phone |
| Set a location price, phone | **Not practical:** it means the dashboard at 285px width and scrolling sideways to find Edit | Home tile, Factory, [toggle], Edit, Continue, Save = **5–6** |

---

## 5. Build order

Sizes: S ≈ half a day, M ≈ 1 day, L ≈ 2 days or more. Each task also includes its docs updates (LEARNING_LOG, ROADMAP, brief).

| # | Task (one per session) | Depends on | Size | Before Oct 15? |
|---|---|---|---|---|
| T1 | `utils/money.js`: 2-decimal mode and the "−₹" sign. Apply to both billing screens and both pricing screens. | — | S | **Essential** |
| T2 | CSS primitives: disabled link-button style, `.action-row`, number-header fix. Apply to both pricing screens. | — | S | **Essential** |
| T3 | BillPriceReview wording: "all N prices", cost-failure note, duplicate PIN sentence removed, "(estimate)" on Total to bill. Both billing screens. | T1 | S | **Essential** |
| T4 | `ConfirmModal size="wide"` shell with the pinned footer and PIN in the same slot. Nothing uses it yet. | T2 | M | **Essential** |
| T5 | `BillReviewPanel` with the two-column layout. BillFulfillmentPicker and BillPriceReview stay as they are, just stacked in the new layout. | T4 | M | **Essential** |
| T6a | BillOrderDetail switches to the panel; article-header money fixed per Q1. | T5 | M | **Essential** |
| T6b | dashboard/Orders switches to the panel, gets Bill No., and the row header stacks on phones. | T5 | M | **Essential** |
| T7 | Merge the picker's article groups and the price-review rows into one article list. | T6a, T6b | M–L | After, if short on time (T5 already gives the wide dialog and fixed footer) |
| T8 | Mobile Article Pricing becomes cards; base-price edit and rename open inline. | T1, T2 | M | **Essential** (needed before T9) |
| T9 | Extract `LocationPriceRows` and add phone set/clear/toggle with PinPrompt to mobile Article Pricing. | T8 | L | **Essential — hard requirement** |
| T10 | Dashboard Article Pricing adopts `LocationPriceRows`, plus cards below 640px. | T9 | M | Essential — otherwise there are two location-price editors |
| T11 | Dashboard shell on phones: top bar, Menu drawer, "Back to the app" always visible. | T2 | M | **Essential** |
| T12 | Overview KPI grid drops to 2 columns, activity rows wrap. | T11 | S | Essential-lite (it's the landing page) |
| T13 | A general phone table layout, applied to Bills and Factories; Bills controls wrap. | T11 | M | After |
| T14 | Locations grids drop columns; popover width `min(320px, 100vw − 32px)`. | T11 | S | After |
| T15 | Dashboard History rows wrap on phones. | T11 | S | After |
| T16 | Mobile base-price edit switches to the two-step PinPrompt, retiring the last hand-built PIN field. | T8 | M | After |

**Schedule risk:** the essential set is roughly 10–12 working days. Oct 15 is 11 working days from today, and you're reviewing one task per session. If something has to give, T7 and T12 go first.

**Browser test lists.** Phone = 375×812; desktop = 1280×800.
- **T1** — Phone: bill with 5% GST shows "+₹801.90"; Article Pricing with a negative margin shows "−₹50 · −3%". Desktop: the same on the Mark-billed dialog and the dashboard pricing board; Total to bill is still a whole rupee and the Rounding line is unchanged.
- **T2** — Phone: pricing table headers line up with their values; Edit looks faded when there's no PIN set. Desktop: the location PIN step shows "Change details" and "Cancel" with space between them; disabled Edit/Rename look faded; enabled ones don't.
- **T3** — Both: an article with 3 baseline prices says "all 3"; making the products request fail shows the cost note; the PIN step shows the changes sentence once; Total to bill says "(estimate)" only after typing a new price.
- **T4** — Phone: the sheet fills the screen, the footer stays visible while scrolling; clicking or tapping outside the wide dialog does nothing, Cancel closes it. Desktop: the dialog is about 1040px wide and centred. On both, archive and other existing 300px confirms look unchanged.
- **T5 / T6a / T6b** — Both: plain bill in 3 taps; the PIN field appears in the footer where the button was; switching location clears the tick and shows the reset note; a forced 409 keeps typed prices and leaves the PIN step; a wrong PIN shows attempts remaining; the request body contains `seenPrices`, and `priceOverrides` only when a price changed; Bill No. is saved from desktop. Phone: element order matches desktop's left column then right column.
- **T8** — Phone: no sideways scroll; Edit opens under its own card; archived-view toggle still works; STAFF can't reach the route. Desktop: the mobile screen at 480px is still usable.
- **T9** — Phone: toggle on; set Delhi to ₹2,080 with PIN; clear it with PIN; margin updates; a wrong PIN shows attempts remaining; typing 12.345 is rejected; only one row can be in edit mode at a time. Desktop: the dashboard shows the value set from the phone.
- **T10** — Desktop: behaves the same as before, now using the shared component. Phone: cards, and the location edit works with a PIN.
- **T11** — Phone: Menu opens every page, "Back to the app" is visible, Lock works, the unlock screen is centred. Desktop: the side menu is unchanged.
- **T12–T15** — Phone: no sideways page scroll, text readable. Desktop: unchanged.
- **T16** — Phone: base-price edit goes fields → Continue → PinPrompt; a wrong PIN clears the field.

---

## 6. Open questions for the owner

1. **Mobile Bill page article headers (the ₹2,000 vs ₹2,080 problem).**
   - **(A) Recommended:** show only sets on the page; money appears only in the bill panel, where the location is known. Example: "6023 Round Neck · 8 sets".
   - (B) Show the quote with a label: "6023 · ₹2,000 quoted".
   - (C) Pick the location on the page itself so the header shows "₹2,080 at GGN". This means a second preview fetch and moving the location control out of the panel.
2. **PIN step.**
   - **(A) Recommended:** keep it as two steps — "Review changes & enter PIN", then the PIN field appears in the same spot and prices lock.
   - (B) Show the PIN field in the footer as soon as any price changes. This saves one tap, but prices stay editable while the PIN is being typed.
3. **Decimals.**
   - **(A) Recommended:** 2 decimals on any amount that can have paise ("−₹801.90 discount", "+₹801.90 GST", "Order total ₹16,038.00"); Total to bill stays a whole rupee ("₹16,838").
   - (B) 2 decimals on every ₹ figure, including "₹16,838.00".
4. **"Different price per location" switch.**
   - **(A) Recommended:** show a confirm on both phone and desktop, e.g. "Turn on location prices for 6023? The next bill from Delhi will charge ₹2,080 instead of ₹2,000." No PIN, per rule 111.
   - (B) Take effect immediately, as desktop does today. This is riskier on a phone where accidental taps are easy.
5. **Mobile-app screens on a desktop browser.**
   - **(A) Recommended:** keep the 480px column; on a PC the owner uses the dashboard.
   - (B) Widen owner screens only, e.g. Article Pricing at 960px.
6. **Dashboard navigation on a phone.**
   - **(A) Recommended:** a Menu button that opens a slide-out list of all 11 pages.
   - (B) A bottom tab bar with 4 pages plus "More".
7. **Bill No. on the desktop Mark-billed dialog.**
   - **(A) Recommended:** add it, so both screens match — "Bill No. (optional) e.g. INV-2291".
   - (B) Leave it out and fill it in later from Parties.

---

## Stale docs I found (not fixed — this task was read-only)

- [05_BUSINESS_RULES.md:313](05_BUSINESS_RULES.md#L313) says "Neither Article Pricing screen has been updated yet… no UI to set a per-location price or flip the toggle". At HEAD, the dashboard screen has both ([dashboard/ArticlePricing.jsx:764-777, 845-1053](frontend/src/pages/dashboard/ArticlePricing.jsx#L764)).
- [07_UI_DESIGN_BRIEF.md:279](07_UI_DESIGN_BRIEF.md#L279) and [:305](07_UI_DESIGN_BRIEF.md#L305) say the dashboard and Parties are "NOT built yet" / "not buildable yet"; both exist.
- [07_UI_DESIGN_BRIEF.md:316](07_UI_DESIGN_BRIEF.md#L316) says the columns are sortable, with a Factory column. Column sorting was removed on 2026-08-26 per [dashboard/ArticlePricing.jsx:20-27](frontend/src/pages/dashboard/ArticlePricing.jsx#L20-L27).
- [07_UI_DESIGN_BRIEF.md:284](07_UI_DESIGN_BRIEF.md#L284) describes a "240px dark sidebar"; the CSS has a 218px white one ([index.css:3353-3359](frontend/src/index.css#L3353-L3359)).
- The CSS comments at [index.css:4607](frontend/src/index.css#L4607) and [4861](frontend/src/index.css#L4861) say 15px text; the actual rules set 14px ([4612](frontend/src/index.css#L4612), [4870](frontend/src/index.css#L4870)).
- [ArticlePricing.jsx:37-40](frontend/src/pages/ArticlePricing.jsx#L37-L40) is accurate today, but will be wrong once T9 lands — its header comment says mobile only shows location prices and desktop edits them.

---

## Owner decisions (2026-09-30)

These override the recommendations and the build-order markings above wherever they differ.

- **Release strategy.** Build T1, T2, T3, T4, T5, T6a and T6b, then do a full re-test and release. **Hard cutoff:** if T6b is not browser-verified by **2026-10-09**, release the latest fully tested state anyway. T8, T9 and T11 are built only if time allows, as a second, smaller release. T7, T10 and T12–T16 are deferred until after release.
- **Q1: NO CHANGE.** The mobile Bill page's article headers keep showing money at the order's quoted price (`priceAtOrder`). The bill panel shows the location's real price once a location is picked. The owner accepts that the two can differ. **T6a must NOT alter the article-header money.**
- **Q2: A.** Keep the two-step PIN; prices lock during the PIN step. Option B is invalid because it contradicts section 3.
- **Q3: A.** 2 decimals on any amount that can have paise; Total to bill stays a whole rupee.
- **Q4: A.** Show a confirm dialog (no PIN) on the "Different price per location" switch, on phone and desktop.
- **Q5: A for this release.** Mobile-app screens keep the 480px column on desktop. Every NEW shared component (the T4 wide dialog and the T5 bill panel) must be responsive from the start. Making every existing screen responsive is the first priority after release.
- **Q6: A.** A Menu button with a slide-out list. Applies when T11 is built, after release.
- **Q7: A.** Add Bill No. (optional) to the desktop Mark-billed dialog.
- **Future, NOT in this plan's scope:** a separate sale-entry page for logging sales made through Delhi (between retail and wholesale). To be discussed and designed after release.
- **Order total position on phone** — accepted below the location picker (T5 column order), owner decision 2026-10-01.
