# Business Rules Reference
## Wholesale Garment Business Management System

Ground-truth rules derived from extensive stress-testing against the real business. Every rule here reflects a confirmed real-world constraint, not an assumption. Organized by domain. Phase tags indicate when each rule becomes actively implemented — but all rules should inform schema design from Phase 1 onward, per `03_DATABASE_SCHEMA.md`.

---

## Inventory & Product Rules (Phase 1)

1. Article numbers are not globally unique — uniqueness holds only when paired with the Factory. The same article number can legitimately exist under different Factories.
2. Garments arrive as bundled sets (e.g. one set = S, M, L, XL) and are **only ever sold as complete sets, never broken apart**. The sellable/trackable unit is the set (Bundle), not an individual piece or size.
3. The size range in a set is fixed per Article — a different size range always means a different Article No. Sizes belong to the Product level, not duplicated per Bundle/Color.
4. The same article comes in multiple colors. A Bundle = Product + Color.
5. **Colors available per article vary** — each article has its own subset of valid colors and its own count of options, not a single shared color chart. Order/stock-entry UI must show only the colors valid for the specific article in play, derived from existing Bundle records.
6. Stock is tracked per Location (e.g. Delhi, Gurgaon), not at rack-level detail. A Bundle can have different stock quantities across multiple Locations.
7. Reordering from the factory is currently gut-feel/visual, based on what looks low — not a formal periodic review. This is acceptable at current business scale.
8. New stock pricing: cost price (from factory) + margin = selling price, decided per article by the owner only.
9. Every stock number must trace back to an actual logged Transaction — nothing is ever a manually-editable number floating with no history.

## Access Control Rules (Phase 1)

10. Only the owner can see what items cost from the factory (`cost_price`); staff only ever see the selling price. This must be enforced server-side (API response shape), not just hidden in the UI.
11. Editing `cost_price` or `selling_price` requires the owner role AND a separate PIN confirmation, entered at the moment of the edit — distinct from the login password. (This revises an earlier, looser decision that role-login alone was sufficient — the PIN layer is the final rule.)
12. Two roles are sufficient: OWNER and STAFF. No action identified across the full business workflow ever required finer-grained permissions beyond price visibility/editing.
13. Staff are not highly technical — UI language should diverge from schema language (e.g. "Bundle" → "Set", "Stock" → "Piece count"), and dropdowns/taps are preferred over free typing wherever possible.

## Device & Platform Rules (Phase 1)

14. **Owner uses both PC and phone; staff uses phone only.** One responsive web app (PWA-installable) serves both — not separate native apps. Because owner isn't PC-only, every screen must work acceptably on mobile as a baseline — desktop just gets to take advantage of extra space when it's available, rather than owner-facing screens assuming desktop-only.
15. All screens must work acceptably on mobile — large tap targets, minimal typing. Owner-facing screens (pricing, corrections, reconciliation) can take advantage of extra space on desktop when it's available, but must never assume desktop-only, since owner also checks the app from a phone.
16. No offline-first / sync architecture is required — connectivity in the field is mostly reliable, and the accepted fallback for drops is manual re-entry, not automatic sync.

## Party & Order Rules (Phase 2)

17. Retail customers are called "Parties." ~15 confirmed regular Parties form the core repeat-purchase cycle; one-off/anonymous walk-in Parties also occur and should be supported without requiring full profile setup.
18. Preferred-article tracking per Party is explicitly not wanted.
19. Formal credit limits per Party are not a current business practice.
20. Payment terms are informally 15–30 days post-delivery, varying by Party track record — not rigidly enforced, but the system should surface it (see Billing rules).
21. Orders do not reliably become bills as originally placed — delays, quantity reductions, returns, cancellations, and miscalculations are routine, not exceptions. The system must treat mid-order changes as a first-class, expected action.
22. **Order quantity can be reduced or changed at any point** — before, during, or after packing has started, right up until the bill is generated. This is a known, recurring, real pain point.
23. Order status is linear and terminal: `Placed → Packed → Billed → Shipped`. "Adjusted" is NOT a status value — it's a separate append-only change log (who changed what, when), writable any time before `Billed`. Once `Billed`, the order is locked; further issues route through Defect/Return or BillCorrection, never back through order edits. (Corrected here — this rule still described the 3-stage version rule 59 explicitly flagged as stale prototype behavior, but was never actually fixed until now.)
24. All order changes must be fully audit-logged — who changed what, and when — visible as real history, not just the final state.
25. **Live order capture during sample visits** (replaces the current WhatsApp-photo workaround): known/repeat Parties are pre-saved so employees select from a list; employee taps/checks articles being ordered, logged directly against that Party's Order. Only what's actually **ordered** is logged — no shown-vs-ordered distinction is needed.
26. When live capture fails due to connectivity, the fallback is the existing photo-and-WhatsApp method — this must still be reconciled into the Order table via a manual "Log Order from Photo" entry screen, same-day, so no order permanently exists only as an unstructured photo.

## Billing Rules (Phase 3)

27. Bill is generated only after counting and packing is fully complete — never before.
28. The existing Excel bill template structure: company header (name, address, GST no.), Party header (name, GST no.), line items by article + **piece-wise quantity** (not set count) + price per piece + line total, auto-summed grand total, amount in words, signature/stamp. Replicate this structure in the new Bill entity.
29. **Bills are immutable once created.** Later issues (returns, adjustments, typos) are handled outside the original bill record — via Defect/Return or BillCorrection — never by editing the original bill.
30. Post-bill clerical corrections (e.g. a staff typo in price/quantity — not a physical defect) go through a distinct `BillCorrection` entity, separate from Defect/Return, since a typo is a financial/clerical error, not a returned garment. Does NOT create a Transaction (no stock physically moved).
31. `Bill.outstandingBalance` = original total ± corrections − payments, computed without ever mutating the original immutable bill.
32. E-way bill is required above ₹50,000 per shipment (transport declaration: company GST, Party GST, transport/bill number). This stays fully external/manual — the app only flags when the threshold is crossed; a human files it on the government/GSP site. **Automated e-way bill filing is out of scope for all phases.**
33. `eWayFlag` is locked to the bill's total at the moment of creation and is never re-evaluated by a later `BillCorrection` — it reflects what was legally declared for goods physically dispatched at that moment.
34. Payment due-date tiers: 15 / 30 / 45 days, tracked per bill alongside delivery date, days elapsed, and days overdue, with outstanding balance shown as a clearly distinct figure (not buried in a running total).

## Payment Rules (Phase 3)

35. Running due balance is tracked per Party, updated as partial payments come in. Partial payment is the norm, not the exception — Parties routinely pay less than the full bill amount.
36. Advance payment is rare but does happen for some Parties.
37. **Default payment allocation is oldest-bill-first (FIFO)** when a payment isn't explicitly tied to a specific bill.
38. **Manual override of FIFO is allowed** at payment-entry time — whoever logs the payment (owner or staff, no new permission tier) can select a specific bill instead. **A Note is mandatory whenever override is used** (not required for default FIFO entries) — every deviation from the default must be traceable to a logged reason.

## Defect & Return Rules (Phase 4)

39. Minor defective returns (1–2 pieces): logged via a Note, does not touch inventory or the original bill.
40. Bulk defective returns (multiple full sets): removed from sellable stock, sent back to the factory, **must create a Transaction** (reason: `DEFECT_RETURN`) — enforcing the founding principle that every stock number traces to a logged Transaction. Handled as a separate adjustment; the original bill stays untouched.

## Sample Handling Rules (Phase 1 / Phase 2 boundary)

41. A sample is pulled from live stock, not tracked as a separate item — it moves into a "reserved for sample" state on the existing Stock row.
42. When stock runs low and a set needs completing for dispatch, samples are physically retrieved and reincorporated — this is the `SAMPLE_RETURN` transaction type. No automatic/scheduled release exists; release only happens when a human physically returns the item.

## Analytics & Notes Rules (Phase 4)

43. Fast/slow-selling tracking will not be a full analytics engine — a simple 3-level manual Flag (Good/Great/Bad), toggle-based and reflaggable over time, is sufficient.
44. A general-purpose Notes field is wanted as an escape hatch for real-world scenarios the app doesn't formally model — generically attachable to any entity, used occasionally, not on every record.

## Explicit Non-Goals (all phases)

45. No multi-tenant support as a feature (schema is designed to be *extensible* toward it later, but this is a single-business tool, not a product).
46. No stock transfers between Locations — accepted limitation; schema-compatible to add later if it ever becomes necessary (would be two Transactions: out at A, in at B).
47. No concurrency/conflict-resolution handling for simultaneous edits — accepted low-probability risk at current scale (2–5 users, weekly-cadence usage). Last-write-wins.
48. No automated GST e-way bill filing, ever — always stays external/manual, app only flags the threshold.

## UI/UX Refinements — Round 6 (Claude Design mockup review)

49. **Sizing**: Adult articles have no pre-selected sizes — staff always selects manually. Common row: M, L, XL, XXL. Extended row (always visible, not hidden): 3XL, 4XL, 5XL, 6XL. Small (S) is available via a "+ add other size" option, not shown in either default row.
50. **Kids garments**: a per-article "Kids" toggle swaps adult sizing for three fixed, **single-select** age categories, each with its own inherent piece count: **1–5yr (5pc set)**, **6–16yr (6pc set)**, **12–18yr (4pc set)**. This supersedes an earlier six-bracket design that counted selections the same way adult sizing does — Kids sizing genuinely works differently: exactly one category is chosen per article, not multiple combined into one set, so piece count is a direct property of the chosen category, not derived by counting. The categories' age ranges overlap in places (12–16 falls within both the second and third) — this is intentional, not a bug: staff pick whichever category matches the actual garment received, the same way they'd pick "M" vs "L" for an adult piece; the system never needs to programmatically resolve an age to a single range.
51. **Factory-scoped article matching, refined**: article lookup during receiving must always offer a "Change" action to re-search — never a dead-end disabled input after a wrong or failed search. A colour typed into a staging input but not explicitly "added" must still be included automatically when the parent article entry is finalized, not silently dropped.
52. **Session-item snapshotting**: when receiving stock, each finalized article entry captures its own Factory, Location, and price at the moment it's finished — not read live from session-level dropdowns later. This prevents a mid-session Factory or price change from corrupting earlier entries in the same receiving session.
53. **Receive Stock grouping**: multiple colours of the same article are staged together and committed as one group under that article — never as separate single-colour-at-a-time entries. The receipt displays as a table, grouped by article, showing sets and pieces (derived from pieces-per-set) per colour line.
54. **New Order factory disambiguation**: if a searched article number exists under more than one Factory, show factory-selection chips before resolving which specific article is meant — article numbers are only unique per Factory, never globally.
55. **Pack Order, dual view**: a Tally view (flat checklist of all open order lines, for physical counting only — does not change order status) alongside the existing Pack List view (grouped by article + factory + party). This satisfies the "to be packed" workload-visibility need without altering the core packing flow.
56. **Low stock threshold, unified**: ≤2 sets remaining triggers a red flag/badge — consistently across Live Stock, Pack Order, and New Order. This replaces earlier looser/inconsistent thresholds. Never fully tint an entire card/row for this — a small flag/badge only, to avoid alarming staff unnecessarily.
57. **Live Stock default view**: factory-grouped collapsible sections (Factory as the outer accordion layer, Articles nested inside), rather than simple dropdown filters. Top-level summary shows total sets and total pieces; each factory section repeats the same summary scoped to that factory (article count, sets, pieces, low-stock count).
58. **History**: a dedicated activity log, reverse-chronological, grouped by date, covering receiving/packing/order/shipping events. Every entry is attributed to the logged-in user with a timestamp. **Edits create a new correcting entry — the original stays visible, never overwritten in place.** This preserves the audit-trail principle (rule 9) even when accommodating real-world mistakes.

## Order Lifecycle & Billing — Round 6 Confirmations

59. **Order status is confirmed as four stages**: Placed → Packed → Billed → Shipped. (A prototyping tool's simplified 3-stage version, if ever seen again, does not reflect the real design — flag it for correction.)
60. **A lightweight "outstanding amount" tracker is a separate, earlier feature from the formal Bill entity.** It computes owed amounts directly from Order pricing (pieces × selling_price) for owner convenience and dues visibility. It is NOT the formal Bill — no immutability, no GST fields, no e-way flagging, no BillCorrection mechanism apply to it.
61. **Formal Bill generation remains genuinely undesigned, separate future work** — the actual invoice document (matching the business's existing Excel template: company/Party GST headers, piece-wise line items, amount in words, signature) still needs its own design pass before implementation. Do not conflate the informal outstanding-tracker with this.
62. **Real authentication is required in the actual build** regardless of what any design/prototyping tool shows — login (bcrypt-hashed passwords) plus the PIN gate on price editing (rules 10–11) are non-negotiable. A UI-only role toggle in a design tool is a prototyping limitation, never a reflection of intended final architecture.

## Order Status Transitions & Pack Order Precision — Round 7 (Claude Design staff prototype)

63. **Staff can only trigger two of the four order status transitions**: Placed → Packed (via "Mark as packed") and Billed → Shipped (via "Mark shipped"). The Placed → ... → Billed transition is owner-only and out of staff scope entirely — no staff-facing UI should offer a way to mark an order Billed directly.
64. **Pack Order's packing quantity is clamped, not blocked**: the packing stepper can be set anywhere from 0 up to the ordered quantity, but never above it (hard clamp). When packing quantity is less than ordered (insufficient stock), the UI must tell staff explicitly that the order will adjust for the shortfall rather than blocking the pack action — staff should never feel stuck unable to proceed. Stock deduction on "Mark as packed" pulls from whichever Location rows for that (article, color) have quantity, in order, until the packed quantity is satisfied (FIFO across locations, not a single hardcoded location).
65. **History corrections require a reason**, chosen from a fixed set of categories (e.g. Miscount, Wrong colour, Wrong customer, Other) — not free text alone. This keeps corrections scannable and consistent, while still allowing an "Other" escape hatch for cases the fixed categories don't cover (consistent with the general Notes philosophy in rule 44).

## Owner Desktop Dashboard — Round 8 (corrections applied, non-negotiable)

66. **The Owner Desktop Dashboard is a Phase 2 feature** (depends on Orders) and a desktop-optimized *addition* for owner, not a replacement for the mobile-usable baseline every screen must meet (rule 15) — owner also checks the app from a phone.
67. **Price editing on the dashboard stays fast/inline but still requires the PIN, no exception.** A design draft of this dashboard omitted the PIN entirely from its inline price-edit flow — that is corrected here permanently: the edit itself can stay lightweight (no heavy Cancel/Confirm modal, since it's genuinely a fast administrative action), but a PIN entry is mandatory at the point of commit. This is not a UI preference, it enforces rules 10–11.
68. **The dashboard's pricing widget must expose both `costPrice` and `sellingPrice`**, never a single collapsed "price" field — consistent with rules 10–11's two-field model. A design draft modeled only one price field; corrected here.
69. **KPI computation basis, explicit**: "Stock value" uses `costPrice` (inventory cost basis). "Revenue" uses `sellingPrice` (what the business actually collects, computed only from Billed/Shipped orders). These are deliberately different fields for different KPIs — never conflate them.
70. **Owner's only order-status action is Packed → Billed**, through the standard confirm modal (unlike price edits, this is a real business-state change and keeps the heavy confirm pattern). Owner never packs or ships directly (reinforces rule 63). Owner's view of History is read-only — no correction affordance on the owner surface, even though staff's History screen has one.
71. **Creating a new article (Product) with no price is any authenticated role — but setting a real price is always OWNER+PIN, whether that happens at creation or later via edit.** The distinction is never "creating vs. editing," it's "does this request set a real price." A prior version of this rule let creation set prices with no PIN check, which was a real gap, not a deliberate exception — corrected here. Staff routinely create new articles during Receive Stock with no price fields at all, landing them in the pending state (rule 8), and that path stays PIN-free; the moment costPrice/sellingPrice appear in the request, OWNER+PIN applies without exception.

## Multi-Owner Support — Round 9

72. **The system supports multiple OWNER-level accounts**, correcting an earlier assumption that there would only ever be one. This was flagged as a known open question when the PIN system was first built and is resolved here.
73. **Every owner sets their own PIN themselves, self-service, after their account is created** — never set by whoever created the account. A newly created owner account starts in a "pending PIN" state (nullable `priceEditPinHash`, the same pattern already used for pending product prices) and cannot perform any price edit until they set their own PIN.
74. **Only the primary owner (the originally-seeded account) can create additional OWNER-role accounts.** An owner created by someone else — even though they have full OWNER access to everything else — cannot themselves grant owner-level access to a further account. This is a one-level restriction, not transitive: owner-creation privilege does not propagate to accounts that didn't originate it.
75. **Users are never hard-deleted, only soft-deactivated** (`isActive: false`). This isn't a UI preference — Transaction and History records reference `userId` and must remain resolvable forever, per the core audit-trail principle (rule 9). A deactivated account can't log in, but every record they ever created stays intact and correctly attributed. Deactivation is reversible.
76. **The role selector in account creation should show what each role actually grants** (a brief description alongside OWNER/STAFF, not just the bare label), so the person creating an account understands what they're granting. The OWNER option should not even be shown to a non-primary-owner creating an account, rather than shown and then rejected — don't offer a choice that will just fail.
77. **Two guards prevent total owner lockout, both mandatory:** nobody can deactivate their own currently-logged-in account, and the last remaining active OWNER-role account can never be deactivated by anyone, primary or not. With only one owner (the current real state of this business), self-deactivation is a genuinely reachable accident, not a theoretical edge case — a misclick on a phone list is enough. Once deactivated, only a primary owner can create a replacement and only an active owner can reactivate anyone, so reaching zero active owners has no API-level recovery path at all.
78. **Accepted risk, consistent with rule 47's precedent**: two different owners simultaneously deactivating two different owners has a genuine TOCTOU race — both could pass their individual "is this the last owner" check before either write commits, theoretically reaching zero active owners despite each check being correct in isolation. Not fixed, deliberately: closing it needs row-level locking this codebase doesn't otherwise use, for an action that happens rarely, among at most a handful of total owner accounts. Same reasoning already accepted for concurrent order edits — real but scale-inappropriate to engineer around.
79. **Saving a receipt requires two sequential confirmations, not one** — a summary step, then a stronger warning that this updates live stock and cannot be undone. This was previously only described in the UI brief's Round 6 refinements and your original request, never given its own rule number here, which is how a wrong citation ("rule 3") happened in a real task. Formalized here to close that gap.

## Factory Payables & Party Details — Round 10

80. **Factories can now be edited, not just created** — owner-only, since GST details are administrative. This closes a real gap: no edit capability existed for any Factory field before this.
81. **Amount payable to a Factory is tracked the same lightweight way as amount owed by a Party** — computed from real Transaction data (STOCK_IN quantity × pieces-per-set × the cost price *at the moment that stock was received*, never the current live price), minus recorded FactoryPayments. This is deliberately not a formal ledger, same reasoning as the party-facing dues tracker.
82. **`Transaction.costPriceSnapshot` exists specifically so a later price change never retroactively alters what was actually owed for a past receipt** — the same principle already applied to `OrderLineItem.priceAtOrder`, now applied to the outgoing (factory) side of the business, not just the incoming (party) side.
83. **Party gets a dedicated `address` field, distinct from the existing `location`** (city/area) — `contact` is confirmed to mean phone number. **Party is now pulled forward into Phase 1 in minimal form** (superseding the earlier "Phase 2 schema-only" note) — real enough to support custom-composition orders and stock returns, without `runningDueBalance`/`tier`, which still depend on the Order/Bill system (Phase 2/3). No full Party management screens are built yet; Party exists to support the two features below.

## Round 11 — Sample Removal, Universal Archiving, Custom-Composition Orders

84. **Sample tracking is removed entirely, with no replacement.** `qtyReservedForSample` and the `SAMPLE_OUT`/`SAMPLE_RETURN` transaction types are gone from the schema. This was confirmed as genuinely unnecessary — common, tacit business knowledge that never needed system modeling, not a gap being left open.
85. **Archiving is universal, not per-entity**: Factory, Article (whole article, all its colors together as one unit — never per-color), Color, Location, Party, and Employee (User) can all be archived (`isActive: false`). Archived records are hidden from daily pickers but remain fully accessible and intact on every historical record that references them — never a hard delete, consistent with the same reasoning already established for User (rule 75).
86. **`PartyStockReturn` is a simple event log, not a pending/settled workflow.** Whole sets returned by a Party (damage, sizing, other reason) get logged after the fact — there is no lifecycle, no per-line partial settlement, no "decision pending" state. Always records which Party, which article/color, the quantity of whole sets (never partial pieces), and a computed cost-based value shown as its own visible figure. **Never touches `Party.runningDueBalance`** — reconciling the return against what's owed is a deliberate manual step, not automatic.
87. **Custom-composition orders exist for the real, occasional case where a Party's order doesn't match an article's standard size range** — either missing a size (e.g. M/L/XL from a standard M/L/XL/XXL set) or an uneven mix (e.g. M/M/L/XL). Logged via an explicit toggle, visually and functionally separate from the normal flow — off, nothing changes about how a normal order works.
88. **A custom-composition order always counts as exactly 1 set for pricing and quantity purposes**, regardless of its actual piece makeup — the real breakdown is recorded separately (`TransactionSizeBreakdown`), manually entered, for cases the standard flow was never asked to model. An optional note field covers anything that doesn't fit the structured breakdown.
89. **`LoosePieces` tracks odd pieces sitting outside a complete set as a result of custom-composition orders.** A size skipped by one order increments this; a later custom order needing an extra piece of that same size draws it down from here first. This is the actual mechanism behind sizes "cancelling out" across separate, unrelated custom orders over time — a real, observed business pattern, not a coincidence to be ignored.
90. **Live Stock must show complete sets and loose/partial pieces as two distinct, separately visible figures** for any article-color-location with loose pieces on record (e.g. "Complete sets: 5, Partial: 1"), with a way to view the specific size breakdown of the partial count. This is a real requirement, not a stretch goal — the whole point of tracking loose pieces structurally rather than as a note is to make this number genuinely visible, not just queryable in theory.

## Round 12 — Category, Transfer, Confirmed Scope

91. **Category is a real, growing entity, same pattern as Color/Factory/Location — never free text.** Seeded with 11 starting values (T-shirts, Lowers, Shirts, Coordsets, Kids, Shorts, Tracksuits, Hoodie, Jacket, Sweatshirt, Others), extendable via a "+ add new category" action, required on every article going forward (not optional, unlike the earlier loose string it replaces).
92. **"Kids" is a real category, independent of `Product.isKids`.** `isKids` controls sizing behavior; Category controls browsing/filtering — they're separate concerns that happen to often coincide. Turning on the Kids sizing toggle during Receive Stock smart-defaults the category picker to "Kids," but never locks it — a kids item can still be categorized as something more specific if that's the better fit. The category picker is always visible during article creation, regardless of the Kids toggle's state.
93. **Transfer is now formally part of the schema** — internal stock movement between the business's own locations, always producing two paired Transaction rows (`TRANSFER_OUT` at the source, `TRANSFER_IN` at the destination) created atomically, so the pair can never exist half-done. This was originally an accepted Phase 1 limitation (rule 46), later designed in a draft review, now confirmed and locked in.
94. **Scope is confirmed through Phase 2.5.** Formal Bill generation and an OCR/LLM-based auto-fill feature (photographing a paper document to auto-populate a bill) are both explicitly *after* that — real ideas, worth having captured accurately, but not designed or built until their turn comes.
