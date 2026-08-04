// Catches any error that reaches here via next(err), or a thrown/rejected async route handler
// (Express 5 auto-forwards those) — the last resort for genuinely unanticipated failures. Every
// other error path in this API already responds with a specific, structured error via
// sendError() at the point the problem is understood; this only fires when nothing upstream
// caught and characterized what went wrong, so — unlike every other error response — the exact
// message is deliberately NOT always shown to the client: a raw unexpected error could contain
// internal details (stack traces, DB internals) that shouldn't go out over the network. Full
// detail is logged server-side either way.
//
// Must keep all four parameters (err, req, res, next), even though `next` is unused here —
// Express only recognizes a middleware function as an ERROR handler by its arity (exactly 4
// params). Drop to 3 and Express treats it as regular middleware, and it never gets called
// for errors at all. Must also be mounted AFTER every route/middleware it's meant to catch
// errors from — Express only routes errors to handlers registered later in the stack.
function errorHandler(err, req, res, next) {
  console.error(err);

  const message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message;

  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

module.exports = errorHandler;
