// "Can THIS ONE location cover this order's packed lines?" — the single implementation, shared by
// the billing preview (GET /api/orders/:id/fulfillment-preview) and the real deduction inside
// billOrder(). Added 2026-09-07, replacing billOrder's previous inline alphabetical walk across
// every Location holding a bundle.
//
// Why this is a shared function rather than two similar-looking checks: the preview exists purely
// to tell an owner, before they commit, exactly what the commit is about to decide. The moment
// those are two separately-written pieces of logic they can disagree — a preview that says "all
// good" followed by a 409 at submit (or worse, the reverse: a preview that scares someone off a
// bill that would actually have succeeded) is a trust problem, not just a bug. One function called
// by both makes that class of divergence impossible by construction rather than by discipline.
//
// What changed and why (see LEARNING_LOG.md for the full entry): billing used to sum a bundle's
// stock across ALL locations, sorted by location name, and draw from each in turn until the line
// was satisfied. That silently allowed one order line to be fulfilled half from Gurgaon and half
// from Delhi — which does not correspond to anything that can physically happen when a person
// packs one box at one place. Fulfillment is now an explicit, single-location decision the biller
// makes and confirms.

// Aggregates demand per bundle before comparing against stock, rather than checking each line
// independently. Two live lines CAN reference the same bundle (createOrder does not dedupe
// bundleIds across lineItems — verified, not assumed), and checking them separately would let two
// lines each needing 2 sets both "pass" against a single shared stock of 3. The previous
// across-all-locations check had this same latent flaw; it isn't reintroduced here.
//
// When a bundle's aggregate demand can't be met, EVERY line drawing on that bundle is reported,
// each carrying its own `needed` and that bundle's real `available` at this location — both
// literally true numbers. For the ordinary one-line-per-bundle order this reads exactly as it
// always did.
//
// `client` is either the top-level Prisma client (preview, and billOrder's pre-check) or a
// transaction client `tx` — this only ever reads, so it is safe in both.
async function checkLocationAvailability(client, { lineItems, locationId }) {
  const bundleIds = [...new Set(lineItems.map((li) => li.bundleId))];

  // Scoped to this ONE location — no other location's rows are fetched at all, so there is
  // nothing here that could fall back to or silently borrow from a second location.
  const stockRows = await client.stock.findMany({
    where: { bundleId: { in: bundleIds }, locationId },
    select: { bundleId: true, qtySets: true },
  });
  const availableByBundle = new Map(stockRows.map((s) => [s.bundleId, s.qtySets]));

  const neededByBundle = new Map();
  for (const li of lineItems) {
    neededByBundle.set(li.bundleId, (neededByBundle.get(li.bundleId) ?? 0) + li.qtySetsPacked);
  }

  // Every line is described, sufficient or not — the preview needs the full picture, and
  // billOrder's own reject path just filters this same list down to the failures.
  const lines = lineItems.map((li) => {
    // No Stock row for this bundle/location pairing at all means zero here, not "unknown" — a
    // bundle that has never been at this location is exactly as unfulfillable from it as one
    // whose stock ran out, and both should read the same way to whoever is looking at the preview.
    const available = availableByBundle.get(li.bundleId) ?? 0;
    const bundleNeeded = neededByBundle.get(li.bundleId) ?? 0;
    return {
      lineItemId: li.id,
      bundleId: li.bundleId,
      needed: li.qtySetsPacked,
      available,
      sufficient: available >= bundleNeeded,
    };
  });

  return {
    lines,
    // Exactly the pinned `[{ lineItemId, bundleId, needed, available }]` shape billOrder's 409
    // has always returned — `sufficient` is dropped here rather than leaking a new field into a
    // response shape the frontend already parses.
    insufficientLines: lines
      .filter((l) => !l.sufficient)
      .map(({ lineItemId, bundleId, needed, available }) => ({ lineItemId, bundleId, needed, available })),
  };
}

// The lines billing actually deducts against: packed, live, non-zero. Shared so the preview shows
// precisely the set the commit will act on — a cancelled or zero-packed line appearing in a
// preview that billing then ignores would be its own small lie.
//
// Cancelled lines are excluded outright: nothing is deducted for them, so they can't make an
// order unfulfillable either — cancelling a line whose stock ran short is exactly how an owner
// unblocks the rest of the order (unchanged from the previous behaviour).
function deductibleLinesOf(order) {
  return order.lineItems.filter((li) => !li.isCancelled && li.qtySetsPacked > 0);
}

module.exports = { checkLocationAvailability, deductibleLinesOf };
