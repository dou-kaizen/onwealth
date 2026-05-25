const UNPARSEABLE = '<unparseable-redis-url>'

/**
 * Replace the password component of a Redis URL with `***` for safe logging.
 *
 * Closes the credential-leak path where ioredis error events include the raw
 * connection URL — without this, a Redis blip would dump `rediss://user:hunter2@host:6379`
 * into the log aggregator on every reconnect attempt.
 *
 * Hardened against malformed input:
 * - non-string / empty → `<unparseable-redis-url>`
 * - `new URL()` throws → `<unparseable-redis-url>` (NEVER propagates the TypeError;
 *   we do not want a Redis blip to crash the bootstrap path)
 *
 * @returns the sanitized URL, or `<unparseable-redis-url>` if parsing fails
 */
export function sanitizeRedisUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return UNPARSEABLE
  try {
    const parsed = new URL(value)
    // `new URL('localhost:6379')` parses as scheme=`localhost:`, hostname=`''`.
    // Reject anything without a non-redis scheme OR without a hostname so we
    // never silently log a credentialled URL that happened to look like
    // `${user}:${pass}@host`.
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') return UNPARSEABLE
    if (parsed.hostname === '') return UNPARSEABLE
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return UNPARSEABLE
  }
}
