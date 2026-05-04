import { randomBytes } from 'crypto'

/**
 * W3C Trace Context utility functions.
 *
 * Spec: https://www.w3.org/TR/trace-context/
 *
 * traceparent format:
 *   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *   │  │                                │                │
 *   │  └─ trace-id (32 hex)              │                └─ trace-flags
 *   │                                   └─ parent-id (16 hex)
 *   └─ version
 *
 * IDs MUST be generated with a CSPRNG — `Math.random()` is non-uniform
 * and predictable, which breaks distributed-tracing collision guarantees
 * and (worse) lets an attacker forge plausible parent spans.
 */

export interface TraceContext {
  version: string
  traceId: string
  parentId: string
  traceFlags: string
}

/**
 * Parse a traceparent header. Returns null on malformed input.
 *
 * Per spec §3.2.2.1, version `ff` is reserved as an invalid sentinel —
 * any traceparent advertising it MUST be rejected and a new context
 * started. We treat unknown future versions (>00) as parseable but the
 * caller should still treat traceId as untrusted.
 */
export function parseTraceparent(traceparent: string): TraceContext | null {
  if (!traceparent || typeof traceparent !== 'string') {
    return null
  }

  const parts = traceparent.split('-')
  if (parts.length !== 4) {
    return null
  }

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

  // Reserved invalid version (W3C Trace Context §3.2.2.1).
  if (version.toLowerCase() === 'ff') {
    return null
  }

  // All-zero trace-id / parent-id are invalid per spec (§3.2.2.2/§3.2.2.3).
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return null
  }

  // Spec mandates lowercase hex on the wire; we accept mixed case on
  // ingest (regex /i) but normalise here so any later forwarding via
  // generateTraceparent() emits a spec-compliant header.
  return {
    version: version.toLowerCase(),
    traceId: traceId.toLowerCase(),
    parentId: parentId.toLowerCase(),
    traceFlags: traceFlags.toLowerCase(),
  }
}

/**
 * Build a fresh traceparent for a downstream call.
 */
export function generateTraceparent(traceId: string, parentId?: string): string {
  const newParentId = parentId ?? generateSpanId()
  return `00-${traceId}-${newParentId}-01`
}

export function generateSpanId(): string {
  return randomBytes(8).toString('hex')
}

export function generateTraceId(): string {
  return randomBytes(16).toString('hex')
}

export function isValidTraceparent(traceparent: string): boolean {
  return parseTraceparent(traceparent) !== null
}
