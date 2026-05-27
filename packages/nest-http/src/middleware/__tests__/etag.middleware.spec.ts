import type { NextFunction, Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ETagMiddleware } from '../etag.middleware.js'

interface MockRes {
  statusCode: number
  headersSent: boolean
  headers: Record<string, string>
  setHeader: ReturnType<typeof vi.fn>
  getHeader: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  json: (body: unknown) => Response
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    headers: {},
    ...overrides,
  } as unknown as Request
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {}
  const res: MockRes = {
    statusCode: 200,
    headersSent: false,
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value
    }),
    getHeader: vi.fn((name: string) => headers[name]),
    status: vi.fn(),
    end: vi.fn(),
    // Default json: just records the body — middleware overrides this with the wrapped version.
    json: vi.fn() as unknown as (body: unknown) => Response,
  }
  // status() returns res for chaining; end() returns res too.
  ;(res.status as unknown as ReturnType<typeof vi.fn>).mockImplementation((code: number) => {
    res.statusCode = code
    return res as unknown as Response
  })
  ;(res.end as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res as unknown as Response)
  return res
}

function runMiddleware(req: Request, res: MockRes, body: unknown): unknown {
  const mw = new ETagMiddleware()
  const next: NextFunction = vi.fn()
  let captured: unknown
  // Replace json with a spy BEFORE running middleware so we can observe the
  // post-handleETag invocation chain.
  res.json = vi.fn((b: unknown) => {
    captured = b
    return res as unknown as Response
  }) as unknown as (body: unknown) => Response
  mw.use(req, res as unknown as Response, next)
  expect(next).toHaveBeenCalled()
  // After `next()` the controller calls res.json(body) — simulate that.
  res.json(body)
  return captured
}

describe('ETagMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets ETag and default Cache-Control on a 200 GET response', () => {
    const req = makeReq()
    const res = makeRes()
    runMiddleware(req, res, { id: 1 })
    expect(res.headers.ETag).toMatch(/^"[a-f0-9]+"$/)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('returns 304 when If-None-Match matches the generated ETag', () => {
    // First request: generate the ETag.
    const req1 = makeReq()
    const res1 = makeRes()
    runMiddleware(req1, res1, { id: 1 })
    const etag = res1.headers.ETag

    // Second request: send the ETag back.
    const req2 = makeReq({ headers: { 'if-none-match': etag } })
    const res2 = makeRes()
    runMiddleware(req2, res2, { id: 1 })

    expect(res2.statusCode).toBe(304)
    expect(res2.end).toHaveBeenCalled()
  })

  it('returns 304 when If-None-Match contains weak ETag matching server ETag (RFC 9110 §8.8.3)', () => {
    // First request: generate strong ETag.
    const res1 = makeRes()
    runMiddleware(makeReq(), res1, { id: 1 })
    const strongETag = res1.headers.ETag

    // Second request: simulate proxy that re-emits the ETag as weak (W/-prefixed).
    const weakETag = `W/${strongETag}`
    const res2 = makeRes()
    runMiddleware(makeReq({ headers: { 'if-none-match': weakETag } }), res2, { id: 1 })

    expect(res2.statusCode).toBe(304)
    expect(res2.end).toHaveBeenCalled()
  })

  it('returns 304 on If-None-Match: * wildcard', () => {
    const req = makeReq({ headers: { 'if-none-match': '*' } })
    const res = makeRes()
    runMiddleware(req, res, { id: 1 })
    expect(res.statusCode).toBe(304)
  })

  it('produces the same ETag for the same body (deterministic)', () => {
    const res1 = makeRes()
    runMiddleware(makeReq(), res1, { a: 1, b: 2 })
    const res2 = makeRes()
    runMiddleware(makeReq(), res2, { a: 1, b: 2 })
    expect(res1.headers.ETag).toBe(res2.headers.ETag)
  })

  it('produces different ETags for different bodies', () => {
    const res1 = makeRes()
    runMiddleware(makeReq(), res1, { id: 1 })
    const res2 = makeRes()
    runMiddleware(makeReq(), res2, { id: 2 })
    expect(res1.headers.ETag).not.toBe(res2.headers.ETag)
  })

  it('Phase 1 C4 regression: 5xx responses keep their Cache-Control: no-store and skip ETag', () => {
    const req = makeReq()
    const res = makeRes()
    res.statusCode = 500
    res.headers['Cache-Control'] = 'no-store'
    runMiddleware(req, res, { error: 'fail' })

    // C4: the error short-circuit MUST run BEFORE we set ETag / overwrite Cache-Control.
    // The pre-set 'no-store' header must survive untouched.
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.headers.ETag).toBeUndefined()
  })

  it('Phase 1 C4 regression: 4xx responses also skip ETag/Cache-Control', () => {
    const req = makeReq()
    const res = makeRes()
    res.statusCode = 422
    runMiddleware(req, res, { error: 'validation' })
    expect(res.headers.ETag).toBeUndefined()
  })

  it('non-GET requests skip ETag entirely', () => {
    const req = makeReq({ method: 'POST' })
    const res = makeRes()
    const mw = new ETagMiddleware()
    const next = vi.fn()
    mw.use(req, res as unknown as Response, next)
    expect(next).toHaveBeenCalled()
    // json was NOT overridden — original vi.fn() is still there.
    res.json({ ok: true })
    expect(res.headers.ETag).toBeUndefined()
  })

  it('controller-set ETag is preserved (optimistic-lock version)', () => {
    const req = makeReq()
    const res = makeRes()
    res.headers.ETag = '"v42"'
    runMiddleware(req, res, { id: 1 })
    expect(res.headers.ETag).toBe('"v42"')
  })

  it('controller-set Cache-Control is preserved (opt-in caching)', () => {
    const req = makeReq()
    const res = makeRes()
    res.headers['Cache-Control'] = 'public, max-age=600'
    runMiddleware(req, res, { id: 1 })
    expect(res.headers['Cache-Control']).toBe('public, max-age=600')
  })
})
