/**
 * Sentinel returned when the input cannot be safely parsed as a Redis URL.
 *
 * Surfaced verbatim in logs so an operator sees that sanitization failed
 * rather than a redacted-looking-but-real URL.
 */
const UNPARSEABLE = '<unparseable-redis-url>'

/**
 * Replace the password component of a Redis URL with `***` for safe logging.
 *
 * Closes the credential-leak path where ioredis error events include the
 * raw connection URL — without this, a Redis blip would dump
 * `rediss://user:hunter2@host:6379` into the log aggregator on every
 * reconnect attempt.
 *
 * **Hardened against malformed input:**
 * - non-string / empty → {@link UNPARSEABLE}.
 * - `new URL()` throws → {@link UNPARSEABLE}. NEVER propagates the
 *   `TypeError`: a Redis blip must not crash the bootstrap path.
 * - `new URL('localhost:6379')` parses as `protocol='localhost:'`,
 *   `hostname=''`. Rejects anything without a `redis:` / `rediss:` scheme
 *   OR without a hostname so we never silently log a credentialled URL
 *   that happened to look like `${user}:${pass}@host`.
 *
 * @param value Anything; only `string` values survive the type guard.
 * @returns Sanitized URL, or {@link UNPARSEABLE} if the input is not a
 *          well-formed Redis URL.
 */
export function sanitizeRedisUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return UNPARSEABLE
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') return UNPARSEABLE
    if (parsed.hostname === '') return UNPARSEABLE
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return UNPARSEABLE
  }
}
