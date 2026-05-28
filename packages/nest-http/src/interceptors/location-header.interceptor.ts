import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { httpConfig } from '../config/http.config.js'

/**
 * Auto-emit the `Location` header on `201 Created` responses, pointing
 * at the canonical URI of the newly-created resource.
 *
 * **Source of `id`:** the response body's `id` field. Numeric ids are
 * coerced to string — RFC 9110 §15.3.2 requires a URI, and auto-increment
 * PKs are valid once stringified.
 *
 * **Origin trust model:** the absolute URL is composed from
 * `httpConfig.apiBaseUrl`, NOT from `request.protocol` / `request.get('host')`.
 * Behind a reverse proxy the Host header is attacker-influenced and the
 * protocol is unreliable (TLS terminated at the LB), so the canonical
 * external origin must come from configuration.
 *
 * Silently skips when status ≠ 201, when the body has no `id`, or when
 * `id` is not a string or number — non-conformant handlers degrade
 * gracefully rather than blowing up the response.
 *
 * @see {@link https://httpwg.org/specs/rfc9110.html#status.201} — RFC 9110 §15.3.2
 */
@Injectable()
export class LocationHeaderInterceptor implements NestInterceptor {
  constructor(
    @Inject(httpConfig.KEY)
    private readonly http: ConfigType<typeof httpConfig>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap((data: unknown) => {
        const httpContext = context.switchToHttp()
        const response = httpContext.getResponse<Response>()
        const request = httpContext.getRequest<Request>()

        if (response.statusCode !== 201) return
        if (!data || typeof data !== 'object' || !('id' in data)) return

        const rawId = (data as Record<string, unknown>).id
        if (
          rawId === null ||
          rawId === undefined ||
          (typeof rawId !== 'string' && typeof rawId !== 'number')
        ) {
          return
        }
        const resourceId = String(rawId)

        const origin = new URL(this.http.apiBaseUrl).origin
        const resourcePath = this.buildResourcePath(request.path, resourceId)
        response.setHeader('Location', `${origin}${resourcePath}`)
      }),
    )
  }

  /**
   * Append `id` to the request path as a fresh URI segment.
   *
   * `encodeURIComponent` guards against path traversal (`../`) and
   * reserved-character injection in raw ids.
   */
  private buildResourcePath(requestPath: string, resourceId: string): string {
    const cleanPath = requestPath.replace(/\/$/, '')
    const safeId = encodeURIComponent(resourceId)
    return `${cleanPath}/${safeId}`
  }
}
