const { sendError } = require('../utils/errors');

// Rejects requests unless req.user.role matches. Must run after requireAuth (auth.js),
// which is what actually populates req.user from the verified token.
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 401, 'UNAUTHENTICATED', 'Not authenticated');
    }
    if (req.user.role !== role) {
      return sendError(res, 403, 'FORBIDDEN_ROLE', `This action requires the ${role} role`);
    }
    next();
  };
}

module.exports = requireRole;
