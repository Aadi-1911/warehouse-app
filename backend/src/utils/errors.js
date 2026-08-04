// Every error response in the API must be shaped { error: { code, message } } (04_API_SPEC.md,
// General Error Conventions). `extra` lets a handler attach sibling fields (e.g. attemptsRemaining)
// alongside `error` without breaking that shape.
function sendError(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: { code, message }, ...extra });
}

module.exports = { sendError };
