import { randomUUID } from 'crypto'

import { parseTraceparent } from './trace-context.util'

import type { Request } from 'express'
import type { ClsModuleOptions, ClsService } from 'nestjs-cls'

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
        return (request.headers['x-request-id'] as string) || randomUUID()
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

  const correlationId = (request.headers['x-correlation-id'] as string) || randomUUID()
  cls.set('correlationId', correlationId)

  const traceparent = request.headers.traceparent as string | undefined
  if (traceparent) {
    const traceContext = parseTraceparent(traceparent)
    if (traceContext) {
      cls.set('traceId', traceContext.traceId)
      cls.set('parentId', traceContext.parentId)
      cls.set('traceFlags', traceContext.traceFlags)
    }
  }

  const tracestate = request.headers.tracestate as string | undefined
  if (tracestate) {
    cls.set('tracestate', tracestate)
  }
}
