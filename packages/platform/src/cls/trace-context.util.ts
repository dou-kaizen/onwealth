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
 */

export interface TraceContext {
  version: string
  traceId: string
  parentId: string
  traceFlags: string
}

/**
 * Parse a traceparent header. Returns null on malformed input.
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

  return { version, traceId, parentId, traceFlags }
}

/**
 * Build a fresh traceparent for a downstream call.
 */
export function generateTraceparent(traceId: string, parentId?: string): string {
  const newParentId = parentId ?? generateSpanId()
  return `00-${traceId}-${newParentId}-01`
}

export function generateSpanId(): string {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function generateTraceId(): string {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

export function isValidTraceparent(traceparent: string): boolean {
  return parseTraceparent(traceparent) !== null
}
