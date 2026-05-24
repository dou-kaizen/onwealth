import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { httpConfig } from '../config/http.config.js'
import { buildLinks, isListResponse, isOffsetListResponse } from './link-header-builder.js'

/**
 * Link header interceptor
 *
 * Spec: RFC 8288 (Web Linking)
 * https://www.rfc-editor.org/rfc/rfc8288.html
 *
 * Features:
 * - Automatically adds Link headers to paginated responses
 * - Supports first, prev, self, next, last relation types
 * - Compliant with RFC 8288 format
 *
 * Base URL composition (M6): the absolute URL is composed from
 * `httpConfig.apiBaseUrl` + `request.path` — NOT `request.protocol` /
 * `request.get('host')`. Reverse proxies make those values attacker-influenced
 * (Host header) and protocol-unreliable (TLS terminated at LB), so the canonical
 * external base must come from configuration.
 */
@Injectable()
export class LinkHeaderInterceptor implements NestInterceptor {
  constructor(
    @Inject(httpConfig.KEY)
    private readonly http: ConfigType<typeof httpConfig>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap((data: unknown) => {
        if (!isListResponse(data)) {
          return
        }

        const httpContext = context.switchToHttp()
        const response = httpContext.getResponse<Response>()
        const request = httpContext.getRequest<Request>()

        // Compose absolute base from configured API_BASE_URL + the request's
        // own path. URL handles trailing-slash normalization for us.
        const origin = new URL(this.http.apiBaseUrl).origin
        const baseUrl = `${origin}${request.path}`

        const links = buildLinks(baseUrl, request.query as Record<string, unknown>, data)
        if (links.length > 0) {
          response.setHeader('Link', links.join(', '))
        }

        if (isOffsetListResponse(data)) {
          response.setHeader('X-Total-Count', String(data.total))
          const totalPages = Math.ceil(data.total / data.pageSize)
          response.setHeader('X-Page-Count', String(totalPages))
        }
      }),
    )
  }
}
