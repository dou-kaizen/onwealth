import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import type { ClsModuleOptions, ClsService } from 'nestjs-cls'
import { parseTraceparent } from '@/app/interceptors/trace-context.util'

// Allowlist regex to block HTTP response splitting and log injection
// via attacker-controlled X-Request-Id / X-Correlation-Id headers.
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
  // Store basic request information
  cls.set('userAgent', request.headers['user-agent'])
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

  // Store Tracestate (optional distributed tracing state)
  const tracestate = request.headers.tracestate as string
  if (tracestate) {
    cls.set('tracestate', tracestate)
  }
}
