import { randomBytes } from 'node:crypto'

/**
 * W3C Trace Context parser and generator helpers.
 *
 * **`traceparent` wire format:**
 * ```
 * 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 * └─ version (2 hex)
 *    └─ trace-id (32 hex)
 *                                     └─ parent-id (16 hex)
 *                                                      └─ trace-flags (2 hex)
 * ```
 *
 * @see {@link https://www.w3.org/TR/trace-context/} — W3C Trace Context
 */

/** Parsed `traceparent` parts. */
export interface TraceContext {
  version: string
  traceId: string
  parentId: string
  traceFlags: string
}

/**
 * Parse a `traceparent` header value into its four parts.
 *
 * Returns `null` for any non-conforming input rather than throwing — the
 * caller (CLS setup) treats invalid headers as "no trace context" and
 * mints a fresh trace ID instead.
 *
 * **Rejection rules (W3C Trace Context §3.2.2):**
 * - Wrong number of segments or wrong segment lengths.
 * - Non-hex characters anywhere.
 * - Reserved version `ff`.
 * - All-zero `trace-id` (means "trace not identified").
 * - All-zero `parent-id` (means "no valid span ancestor").
 *
 * @example
 * parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
 * // { version: '00', traceId: '4bf9…4736', parentId: '00f0…02b7', traceFlags: '01' }
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  if (!traceparent || typeof traceparent !== 'string') return null

  const parts = traceparent.split('-')
  if (parts.length !== 4) return null

  const [version, traceId, parentId, traceFlags] = parts

  if (
    version?.length !== 2 ||
    traceId?.length !== 32 ||
    parentId?.length !== 16 ||
    traceFlags?.length !== 2
  ) {
    return null
  }

  const hexRegex = /^[0-9a-f]+$/i
  if (
    !hexRegex.test(version) ||
    !hexRegex.test(traceId) ||
    !hexRegex.test(parentId) ||
    !hexRegex.test(traceFlags)
  ) {
    return null
  }

  if (version === 'ff' || traceId === '0'.repeat(32) || parentId === '0'.repeat(16)) {
    return null
  }

  return { version, traceId, parentId, traceFlags }
}

/**
 * Compose a `traceparent` header for a downstream call.
 *
 * @param traceId — keep the parent trace ID unchanged so the child span
 *                  joins the same distributed trace.
 * @param parentId — optional span ID; a fresh one is minted when omitted
 *                   so the downstream service appears as a new child span.
 * @returns the formatted `version-traceId-parentId-flags` string.
 *
 * @example
 * generateTraceparent('4bf92f3577b34da6a3ce929d0e0e4736')
 * // '00-4bf9…4736-<new-span-id>-01'
 */
export function generateTraceparent(traceId: string, parentId?: string): string {
  const newParentId = parentId ?? generateSpanId()
  return `00-${traceId}-${newParentId}-01`
}

/**
 * Mint a fresh 64-bit span ID (8 random bytes → 16 hex chars).
 *
 * Uses `node:crypto`'s CSPRNG so span IDs cannot be guessed — important
 * because they appear in shared distributed-trace storage.
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Mint a fresh 128-bit trace ID (16 random bytes → 32 hex chars).
 *
 * Uses `node:crypto`'s CSPRNG for the same reason as
 * {@link generateSpanId} — trace IDs are shared across services.
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Boolean wrapper around {@link parseTraceparent} for callers that only
 * need a yes/no answer.
 */
export function isValidTraceparent(traceparent: string): boolean {
  return parseTraceparent(traceparent) !== null
}
