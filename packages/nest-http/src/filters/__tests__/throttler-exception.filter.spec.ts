import type { ArgumentsHost } from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import type { Request } from 'express'
import type { ClsService } from 'nestjs-cls'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThrottlerExceptionFilter } from '../throttler-exception.filter.js'

function makeRes() {
  const headers: Record<string, string> = {}
  let bodyCapture: unknown
  let statusCapture = 0
  const res = {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value
    }),
    status: vi.fn((code: number) => {
      statusCapture = code
      return res
    }),
    json: vi.fn((body: unknown) => {
      bodyCapture = body
      return res
    }),
    getStatus: () => statusCapture,
    getBody: () => bodyCapture,
  }
  return res
}

function makeArgsHost(req: Partial<Request>, res: ReturnType<typeof makeRes>): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => req as T,
      getResponse: <T = unknown>() => res as unknown as T,
      getNext: <T = unknown>() => undefined as unknown as T,
    }),
  } as unknown as ArgumentsHost
}

function makeCls(overrides: Partial<Record<string, string>> = {}): ClsService {
  return {
    getId: () => overrides.requestId ?? 'req_test123',
    get: (key: string) => overrides[key],
  } as unknown as ClsService
}

describe('ThrottlerExceptionFilter', () => {
  let filter: ThrottlerExceptionFilter
  let res: ReturnType<typeof makeRes>
  let host: ArgumentsHost
  const req: Partial<Request> = { method: 'GET', url: '/api/x', ip: '1.2.3.4' }

  beforeEach(() => {
    const cls = makeCls({ correlationId: 'corr_abc', traceId: 'trace_xyz' })
    filter = new ThrottlerExceptionFilter(cls, { ttl: 60_000, limit: 100 }, {
      apiBaseUrl: 'https://api.example.com',
    } as never)
    res = makeRes()
    host = makeArgsHost(req, res)
  })

  it('responds with 429 status', () => {
    filter.catch(new ThrottlerException(), host)
    expect(res.getStatus()).toBe(429)
  })

  it('sets RFC 6585 Retry-After header equal to floor(ttlMs/1000)', () => {
    filter.catch(new ThrottlerException(), host)
    expect(res.headers['Retry-After']).toBe('60')
  })

  it('sets IETF X-RateLimit-* headers', () => {
    const now = Math.floor(Date.now() / 1000)
    filter.catch(new ThrottlerException(), host)
    expect(res.headers['X-RateLimit-Limit']).toBe('100')
    expect(res.headers['X-RateLimit-Remaining']).toBe('0')
    const reset = Number(res.headers['X-RateLimit-Reset'])
    // Reset should be roughly now + 60s; tolerate clock skew within the test.
    expect(reset).toBeGreaterThanOrEqual(now + 59)
    expect(reset).toBeLessThanOrEqual(now + 61)
  })

  it('sets Content-Type to application/problem+json (RFC 9457)', () => {
    filter.catch(new ThrottlerException(), host)
    expect(res.headers['Content-Type']).toBe('application/problem+json')
  })

  it('body matches ProblemDetailsDto shape with type URI and tracing IDs', () => {
    filter.catch(new ThrottlerException(), host)
    const body = res.getBody() as Record<string, unknown>
    expect(body.status).toBe(429)
    expect(body.title).toBe('Too Many Requests')
    expect(body.type).toBe('https://api.example.com/errors/rate-limit-exceeded')
    expect(body.instance).toBe('/api/x')
    expect(body.request_id).toBe('req_test123')
    expect(body.correlation_id).toBe('corr_abc')
    expect(body.trace_id).toBe('trace_xyz')
    expect(typeof body.timestamp).toBe('string')
  })

  it('body errors[] includes RATE_LIMIT_EXCEEDED entry with constraints', () => {
    filter.catch(new ThrottlerException(), host)
    const body = res.getBody() as { errors: Array<Record<string, unknown>> }
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors).toHaveLength(1)
    const entry = body.errors[0]
    expect(entry?.code).toBe('RATE_LIMIT_EXCEEDED')
    expect((entry?.constraints as Record<string, unknown> | undefined)?.limit).toBe(100)
    expect((entry?.constraints as Record<string, unknown> | undefined)?.remaining).toBe(0)
  })
})
