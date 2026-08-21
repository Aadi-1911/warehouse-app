const express = require('express');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  listParties,
  createParty,
  deactivateParty,
  reactivateParty,
  getPartyRevenue,
  getPartyPayable,
} = require('../controllers/partyController');

const router = express.Router();

router.get('/', requireAuth, listParties);
// Any authenticated role as of 2026-08-18 (was OWNER-only). Staff meet new customers during a
// sales visit and need to record them on the spot to place an order — the same staff-primary
// reasoning rule 25 already applies to POST /api/orders. Withholding creation meant a staff
// member with a real new customer in front of them was blocked until an owner was available.
// This puts Party in line with Factory/Color/Category, which have always been any-role.
router.post('/', requireAuth, createParty);
// Archive/reactivate stay OWNER-only, deliberately: creating a record is additive and low-risk,
// whereas archiving removes an existing customer from everyone else's pickers. Different blast
// radius, so a different gate — this is not an oversight left behind by the change above.
router.patch('/:id/deactivate', requireAuth, requireRole('OWNER'), deactivateParty);
router.patch('/:id/reactivate', requireAuth, requireRole('OWNER'), reactivateParty);
// OWNER only — matches GET /api/dashboard/overview's own gating for the same underlying figure
// (utils/revenue.js's computeRevenue), just scoped to one party. Owner Dashboard's Parties page
// (§8) is the only caller.
router.get('/:id/revenue', requireAuth, requireRole('OWNER'), getPartyRevenue);
// OWNER only, PIN not required — matches GET /api/factories/:id/payable's own gating (reading a
// figure isn't itself a financial action; PIN is reserved for the actual writes on
// /api/party-payments). Party Payables, added 2026-08-21.
router.get('/:id/payable', requireAuth, requireRole('OWNER'), getPartyPayable);

module.exports = router;
