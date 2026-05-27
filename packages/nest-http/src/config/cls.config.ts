import { randomUUID } from 'node:crypto'
import { sanitizeHeaderValue } from '@boilerplate/shared-kernel'
import type { Request } from 'express'
import type { ClsModuleOptions, ClsService } from 'nestjs-cls'
import { parseTraceparent } from '../interceptors/trace-context.util.js'

/**
 * Strict allowlist regex for ID-style headers (X-Request-Id / X-Correlation-Id).
 *
 * More restrictive than the shared header sanitizer because these IDs are
 * used as log correlation keys — only word chars + hyphen survive, and
 * length is capped at 128.
 */
const SAFE_ID_RE = /^[\w-]{1,128}$/

/**
 * Apply {@link SAFE_ID_RE} to a client-supplied ID header.
 *
 * @returns the value if it passes the allowlist, `undefined` otherwise.
 *          Callers then fall back to a generated UUID.
 */
function sanitizeClientId(value: string | undefined): string | undefined {
  return value && SAFE_ID_RE.test(value) ? value : undefined
}

/**
 * Build the nestjs-cls module config for request-scoped context propagation.
 *
 * Sets up:
 * - Request ID generation (client-provided or random UUID).
 * - Correlation ID tracking.
 * - W3C Trace Context parsing.
 *
 * Mounted globally so any provider can pull the active request context via
 * `ClsService.get(key)` without explicit injection into the call chain.
 */
export function createClsConfig(): ClsModuleOptions {
  return {
    global: true,
    middleware: {
      mount: true,
      generateId: true,
      idGenerator: (request: Request) => {
        return (
          sanitizeClientId(request.headers['x-request-id'] as string | undefined) ?? randomUUID()
        )
      },
      setup: setupClsContext,
    },
  }
}

/**
 * Populate the CLS store with per-request tracing metadata.
 *
 * **Sanitization rationale:** `userAgent` and `tracestate` are
 * attacker-controlled headers; passing them through
 * {@link sanitizeHeaderValue} blocks log injection via CR/LF/TAB/NUL/ANSI
 * escape sequences that would otherwise corrupt log shippers downstream.
 *
 * **Tracestate truncation:** W3C Trace Context §3.3.2 mandates a 512-byte
 * maximum for the header. We truncate first, then sanitize — slicing after
 * sanitization could strip the sentinel that bounds the field.
 */
function setupClsContext(cls: ClsService, request: Request) {
  const rawUserAgent = request.headers['user-agent']
  cls.set('userAgent', rawUserAgent ? sanitizeHeaderValue(rawUserAgent) : undefined)
  cls.set('ip', request.ip)
  cls.set('method', request.method)
  cls.set('url', request.url)

  const correlationId =
    sanitizeClientId(request.headers['x-correlation-id'] as string | undefined) ?? randomUUID()
  cls.set('correlationId', correlationId)

  const traceparent = request.headers.traceparent as string
  if (traceparent) {
    const traceContext = parseTraceparent(traceparent)
    if (traceContext) {
      cls.set('traceId', traceContext.traceId)
      cls.set('parentId', traceContext.parentId)
      cls.set('traceFlags', traceContext.traceFlags)
    }
  }

  const tracestate = request.headers.tracestate as string
  if (tracestate) {
    cls.set('tracestate', sanitizeHeaderValue(tracestate.slice(0, 512)))
  }
}
