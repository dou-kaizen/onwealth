import { randomUUID } from 'node:crypto'
import { sanitizeHeaderValue } from '@onwealth/shared-kernel'
import type { Request } from 'express'
import type { ClsModuleOptions, ClsService } from 'nestjs-cls'
import { parseTraceparent } from '../interceptors/trace-context.util.js'

// Strict allowlist regex for ID-style headers (X-Request-Id / X-Correlation-Id).
// More restrictive than the shared sanitizer because IDs are used as log
// correlation keys — only word chars + hyphen survive.
const SAFE_ID_RE = /^[\w-]{1,128}$/

function sanitizeClientId(value: string | undefined): string | undefined {
  return value && SAFE_ID_RE.test(value) ? value : undefined
}

/**
 * Create CLS (Continuation-Local Storage) configuration
 *
 * Used for request context management, including:
 * - Request ID generation
 * - Correlation ID tracking
 * - W3C Trace Context parsing
 * - API version management
 */
export function createClsConfig(): ClsModuleOptions {
  return {
    global: true,
    middleware: {
      mount: true,
      generateId: true,
      idGenerator: (request: Request) => {
        // Use the client-provided X-Request-Id if valid; otherwise generate a fresh UUID.
        return (
          sanitizeClientId(request.headers['x-request-id'] as string | undefined) ?? randomUUID()
        )
      },
      setup: setupClsContext,
    },
  }
}

/**
 * Set up the CLS context
 *
 * Extracts and stores various tracing information from request headers
 */
function setupClsContext(cls: ClsService, request: Request) {
  // Store basic request information.
  // userAgent is attacker-controlled — sanitize before storage to block log injection
  // (CR/LF/TAB/NUL/ANSI escape sequences from User-Agent into log shipper).
  const rawUserAgent = request.headers['user-agent']
  cls.set('userAgent', rawUserAgent ? sanitizeHeaderValue(rawUserAgent) : undefined)
  cls.set('ip', request.ip)
  cls.set('method', request.method)
  cls.set('url', request.url)

  // Parse and store Correlation ID (business tracing)
  const correlationId =
    sanitizeClientId(request.headers['x-correlation-id'] as string | undefined) ?? randomUUID()
  cls.set('correlationId', correlationId)

  // Parse W3C Trace Context (distributed tracing)
  const traceparent = request.headers.traceparent as string
  if (traceparent) {
    const traceContext = parseTraceparent(traceparent)
    if (traceContext) {
      cls.set('traceId', traceContext.traceId)
      cls.set('parentId', traceContext.parentId)
      cls.set('traceFlags', traceContext.traceFlags)
    }
  }

  // Store Tracestate (optional distributed tracing state).
  // W3C Trace Context §3.3.2 mandates a 512-byte maximum for the tracestate header.
  // [Phase 2 H2] Sanitize after the 512-byte truncate to block log injection from
  // attacker-controlled CR/LF/TAB/NUL/ANSI in the tracestate value.
  const tracestate = request.headers.tracestate as string
  if (tracestate) {
    cls.set('tracestate', sanitizeHeaderValue(tracestate.slice(0, 512)))
  }
}
