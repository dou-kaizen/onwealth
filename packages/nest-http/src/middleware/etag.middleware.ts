import * as crypto from 'node:crypto'
import type { NestMiddleware } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

/**
 * RFC 9110 ETag middleware — emits a content-hash `ETag` on every
 * cacheable response and honours `If-None-Match` with `304 Not Modified`.
 *
 * **Scope:** GET and HEAD only. Mutating methods and error responses
 * (`status >= 400`) bypass the middleware so Problem Details bodies
 * (which carry `request_id` / `trace_id`) are never cached by browsers
 * or CDNs.
 *
 * **Implementation:** intercepts `res.json` and rewrites it to inject
 * the `ETag` header before delegating to the original. If the controller
 * already set an `ETag` (e.g. an optimistic-lock version) it is reused
 * verbatim instead of being overwritten.
 *
 * **Cache-Control:** defaults to `no-store` when the handler did not set
 * one — opt-in caching only. Any explicit `@Header('Cache-Control', …)`
 * on the route wins.
 *
 * **Format:** strong ETag (`"<md5>"`). Weak ETags (`W/"…"`) are not
 * currently produced — content hash is exact-match by construction.
 *
 * @see {@link https://httpwg.org/specs/rfc9110.html#field.etag} — RFC 9110 §8.8.3
 * @see {@link https://httpwg.org/specs/rfc9110.html#status.304} — RFC 9110 §15.4.5
 *
 * @example
 * // First request
 * GET /api/users/123
 * → 200 OK
 *   ETag: "33a64df551425fcc"
 *   { "id": "usr_123", ... }
 *
 * @example
 * // Conditional request
 * GET /api/users/123
 * If-None-Match: "33a64df551425fcc"
 * → 304 Not Modified
 *   ETag: "33a64df551425fcc"
 */
@Injectable()
export class ETagMiddleware implements NestMiddleware {
  use(request: Request, res: Response, next: NextFunction) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return next()
    }

    const originalJson = res.json.bind(res) as (body: unknown) => Response
    res.json = ((body: unknown) => {
      return this.handleETag(request, res, body, originalJson)
    }) as typeof res.json

    next()
  }

  /**
   * Generate-or-reuse the `ETag`, set a safe default `Cache-Control`,
   * and short-circuit to `304` on a matching `If-None-Match`.
   *
   * Headers already sent or error statuses (`>= 400`) bypass entirely
   * so error bodies are never cached.
   */
  private handleETag(
    request: Request,
    res: Response,
    body: unknown,
    originalJson: (body: unknown) => Response,
  ): Response {
    if (res.headersSent) return originalJson(body)
    if (res.statusCode >= 400) return originalJson(body)

    const existingETag = res.getHeader('ETag') as string | undefined
    const etag = existingETag ?? this.generateETag(body)
    if (!existingETag) {
      res.setHeader('ETag', etag)
    }

    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store')
    }

    const ifNoneMatch = request.headers['if-none-match']
    if (ifNoneMatch) {
      const etags = new Set(ifNoneMatch.split(',').map((e) => e.trim()))
      if (etags.has(etag) || etags.has('*')) {
        return res.status(304).end()
      }
    }

    return originalJson(body)
  }

  /**
   * Compute a strong `ETag` from a JSON-stringified body.
   *
   * @param data — payload destined for `res.json`.
   * @returns the value `"<md5-hex>"` (quoted per RFC 9110 strong-ETag format).
   */
  private generateETag(data: unknown): string {
    const hash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')
    return `"${hash}"`
  }
}
