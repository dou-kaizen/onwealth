/**
 * Sensitive-field redaction paths.
 *
 * Pino redact uses dot/bracket notation; `*` matches any segment. Adding
 * `res.headers["set-cookie"]` here is the foundation-level fix from the
 * xia plan (reference repo only redacted request cookies).
 */
export const redactPaths = [
  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',

  // Response headers — set-cookie can leak session tokens in logs
  'res.headers["set-cookie"]',

  // Generic sensitive fields (any nesting depth)
  '*.password',
  '*.confirmPassword',
  '*.oldPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
  '*.privateKey',
  '*.creditCard',
  '*.cardNumber',
  '*.cvv',
  '*.ssn',

  // Request body
  'req.body.password',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.secret',

  // Response body
  'res.body.token',
  'res.body.accessToken',
  'res.body.refreshToken',
]

export const redactCensor = '[REDACTED]'
