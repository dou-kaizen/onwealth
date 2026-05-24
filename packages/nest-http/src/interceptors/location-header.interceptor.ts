import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { httpConfig } from '../config/http.config.js'

/**
 * Location header interceptor
 *
 * Spec: RFC 9110 §15.3.2 (201 Created)
 * https://httpwg.org/specs/rfc9110.html#status.201
 *
 * Features:
 * - Automatically adds a Location header to 201 Created responses
 * - The Location header points to the URI of the newly created resource
 * - Automatically constructs the URI from the id field in the response data
 *
 * Base URL composition (M6): uses `httpConfig.apiBaseUrl` as the canonical
 * external origin instead of `request.protocol` / `request.get('host')`, which
 * are attacker-influenced behind a reverse proxy.
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

        // Only process 201 Created responses
        if (response.statusCode !== 201) {
          return
        }

        // Check whether the response data contains an id field.
        // Coerce numeric ids to string (e.g. auto-increment PKs) — RFC 9110 §15.3.2
        // requires a URI, so numeric ids are valid once stringified.
        if (!data || typeof data !== 'object' || !('id' in data)) {
          return
        }
        const rawId = (data as Record<string, unknown>).id
        if (
          rawId === null ||
          rawId === undefined ||
          (typeof rawId !== 'string' && typeof rawId !== 'number')
        ) {
          return
        }
        const resourceId = String(rawId)

        // Compose absolute base from configured API_BASE_URL.
        const origin = new URL(this.http.apiBaseUrl).origin
        const resourcePath = this.buildResourcePath(request.path, resourceId)

        response.setHeader('Location', `${origin}${resourcePath}`)
      }),
    )
  }

  /**
   * Build the resource path.
   *
   * encodeURIComponent prevents path traversal via `../` or special chars in the id.
   */
  private buildResourcePath(requestPath: string, resourceId: string): string {
    const cleanPath = requestPath.replace(/\/$/, '')
    const safeId = encodeURIComponent(resourceId)
    return `${cleanPath}/${safeId}`
  }
}
