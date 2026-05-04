import { randomUUID } from 'crypto'

import { generateTraceId, parseTraceparent } from './trace-context.util'

import type { Request } from 'express'
import type { ClsModuleOptions, ClsService } from 'nestjs-cls'

/**
 * Caps for client-supplied correlation headers. 128 chars covers UUIDs,
 * ULIDs, and most upstream tracing IDs — anything longer is either a
 * misconfigured client or a header-smuggling probe; replace with a
 * fresh UUID rather than echoing it back into logs / downstream calls.
 */
const MAX_HEADER_ID_LENGTH = 128

/**
 * Cap on `tracestate` length per W3C spec (§3.3.1.3 recommends 512).
 * Also strip CR/LF defensively: today the value lives only in CLS, but
 * once an outbound HTTP client / propagation interceptor is wired, an
 * attacker-controlled `\r\n` would otherwise enable header smuggling
 * on the downstream request.
 */
const MAX_TRACESTATE_LENGTH = 512

/**
 * CLS (Continuation-Local Storage) configuration.
 *
 * Captures per-request:
 * - request id (from `x-request-id` header or generated UUID)
 * - correlation id (from `x-correlation-id` header or generated UUID)
 * - W3C Trace Context (traceId / parentId / traceFlags / tracestate)
 * - basic request metadata (method/url/ip/user-agent)
 */
export function createClsConfig(): ClsModuleOptions {
  return {
    global: true,
    middleware: {
      mount: true,
      generateId: true,
      idGenerator: (request: Request) => {
        return sanitizeHeaderId(request.headers['x-request-id'])
      },
      setup: setupClsContext,
    },
  }
}

function setupClsContext(cls: ClsService, request: Request): void {
  cls.set('userAgent', request.headers['user-agent'])
  cls.set('ip', request.ip)
  cls.set('method', request.method)
  cls.set('url', request.url)

  cls.set('correlationId', sanitizeHeaderId(request.headers['x-correlation-id']))

  // Always mint a CSPRNG traceId so untraced requests (browsers, K8s
  // probes, internal callers without traceparent) still appear in APM
  // and logs. If a valid inbound traceparent is present, parentId /
  // traceFlags are captured below — the local traceId is never replaced
  // by the client-supplied value (collision / dashboard-poisoning risk).
  cls.set('traceId', generateTraceId())

  const traceparent = request.headers.traceparent as string | undefined
  if (traceparent) {
    const traceContext = parseTraceparent(traceparent)
    if (traceContext) {
      cls.set('parentId', traceContext.parentId)
      cls.set('traceFlags', traceContext.traceFlags)
    }
  }

  const tracestate = request.headers.tracestate
  if (typeof tracestate === 'string' && tracestate.length > 0) {
    const stripped = tracestate.replaceAll(/[\r\n]/g, '')
    if (stripped.length > 0) {
      cls.set('tracestate', stripped.slice(0, MAX_TRACESTATE_LENGTH))
    }
  }
}

/**
 * Coerce a header value to a single safe id string. Falls back to a
 * fresh UUID when the header is missing, an array (header smuggling),
 * empty, or longer than the cap.
 */
function sanitizeHeaderId(raw: string | string[] | undefined): string {
  if (typeof raw !== 'string') return randomUUID()
  if (raw.length === 0 || raw.length > MAX_HEADER_ID_LENGTH) return randomUUID()
  return raw
}
