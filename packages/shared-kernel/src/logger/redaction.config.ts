/**
 * Field paths redacted from pino log output.
 *
 * Path syntax follows pino's `redact.paths` (supports `*` wildcards). Three
 * groupings, intentionally over-broad to fail-closed on new payload shapes:
 *
 * 1. **Request headers** — explicit, fixed paths so we never log auth tokens
 *    even if a downstream pretty-printer would otherwise dump headers.
 * 2. **Generic credentials** — wildcard paths catch any nesting depth so a
 *    DTO renamed/reshaped does not silently leak a `password` field.
 * 3. **Redis / BullMQ connection objects** — close the credential-leak path
 *    where ioredis logs the full connection options on a reconnect error.
 */
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',

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

  'req.body.password',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.secret',

  'res.body.token',
  'res.body.accessToken',
  'res.body.refreshToken',
  'res.headers["set-cookie"]',

  '*.connectionOptions.password',
  '*.options.password',
  '*.connection.password',
  '*.redisOpts.password',
]

/** Placeholder value substituted for any path matched by {@link redactPaths}. */
export const redactCensor = '[REDACTED]'
