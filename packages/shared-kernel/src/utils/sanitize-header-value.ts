// Strip CR / LF / TAB / NUL + ANSI escape sequences and truncate to 128 chars.
// Closes the log-injection / response-splitting vector for client-controlled
// header values (X-Correlation-Id, X-Request-Id, traceparent, tracestate, User-Agent).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require \x1b
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
const STRIP_RE = /[\r\n\t\0]/g

const MAX_LEN = 128

export function sanitizeHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const str = typeof value === 'string' ? value : String(value)
  return str.slice(0, MAX_LEN).replace(STRIP_RE, '').replace(ANSI_RE, '')
}
