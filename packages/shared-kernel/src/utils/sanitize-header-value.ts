// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
const STRIP_RE = /[\r\n\t\0]/g

const MAX_LEN = 128

/**
 * Sanitize a client-supplied header value before it enters structured logs.
 *
 * Closes the log-injection / response-splitting vector for any header value
 * a client controls (`X-Correlation-Id`, `X-Request-Id`, `traceparent`,
 * `tracestate`, `User-Agent`).
 *
 * **Operations applied in order:**
 * 1. Coerce non-strings to `String(value)` so a malicious array/object
 *    cannot bypass the regex passes.
 * 2. Truncate to 128 chars — bounds adversarial-length input and keeps log
 *    lines readable.
 * 3. Strip `\r \n \t \0` — the four control characters that can forge
 *    additional log lines or break parsers.
 * 4. Strip ANSI escape sequences — prevents a colour-injecting client from
 *    hiding text in terminal-rendered log viewers.
 *
 * @returns the sanitized string, or `undefined` if input was null/undefined.
 */
export function sanitizeHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const str = typeof value === 'string' ? value : String(value)
  return str.slice(0, MAX_LEN).replace(STRIP_RE, '').replace(ANSI_RE, '')
}
