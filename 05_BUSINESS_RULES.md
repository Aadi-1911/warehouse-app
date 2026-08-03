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

14. Staff access the system on **phone only**. Owner accesses it on **PC only**. One responsive web app (PWA-installable) serves both — not separate native apps.
15. Staff-facing screens must be mobile-first (large tap targets, minimal typing). Owner-facing screens can assume desktop screen real estate.
16. No offline-first / sync architecture is required — connectivity in the field is mostly reliable, and the accepted fallback for drops is manual re-entry, not automatic sync.

## Party & Order Rules (Phase 2)

17. Retail customers are called "Parties." ~15 confirmed regular Parties form the core repeat-purchase cycle; one-off/anonymous walk-in Parties also occur and should be supported without requiring full profile setup.
18. Preferred-article tracking per Party is explicitly not wanted.
19. Formal credit limits per Party are not a current business practice.
20. Payment terms are informally 15–30 days post-delivery, varying by Party track record — not rigidly enforced, but the system should surface it (see Billing rules).
21. Orders do not reliably become bills as originally placed — delays, quantity reductions, returns, cancellations, and miscalculations are routine, not exceptions. The system must treat mid-order changes as a first-class, expected action.
22. **Order quantity can be reduced or changed at any point** — before, during, or after packing has started, right up until the bill is generated. This is a known, recurring, real pain point.
23. Order status is linear and terminal: `Placed → Packed → Billed`. "Adjusted" is NOT a status value — it's a separate append-only change log (who changed what, when), writable any time before `Billed`. Once `Billed`, the order is locked; further issues route through Defect/Return or BillCorrection, never back through order edits.
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
50. **Kids garments**: a per-article "Kids" toggle swaps the size vocabulary from letter sizes to age brackets. Confirmed full list: 2-3Y, 4-5Y, 6-7Y, 8-9Y, 10-11Y, 12-13Y (six brackets, clean 2-year steps). Pieces-per-set uses the same unified rule as adult sizing: it equals however many size/age options are selected — no separate 4pc/6pc lookup table needed.
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
