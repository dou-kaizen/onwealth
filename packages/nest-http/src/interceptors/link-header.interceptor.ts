import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Inject, Injectable } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Request, Response } from 'express'
import type { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { httpConfig } from '../config/http.config.js'
import { buildLinks, isListResponse, isOffsetListResponse } from './link-header-builder.js'

/**
 * Attach an RFC 8288 `Link` header (with `first`/`prev`/`self`/`next`/`last`
 * relations) to any paginated list response, plus `X-Total-Count` and
 * `X-Page-Count` siblings for offset pagination clients that prefer
 * non-Link headers.
 *
 * **Activation:** only when the body duck-types as a list envelope
 * (`{ object: 'list', data: [...] }`). Single-resource responses pass
 * through untouched.
 *
 * **Origin trust model:** absolute URLs are composed from
 * `httpConfig.apiBaseUrl` + `request.path`, NOT from `request.protocol` /
 * `request.get('host')`. Behind a reverse proxy the Host header is
 * attacker-influenced and the protocol is unreliable (TLS terminated at
 * the LB), so the canonical external origin must come from configuration.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288.html} — RFC 8288 (Web Linking)
 * @see {@link buildLinks} — pure link-string builder (extracted for unit testing).
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
        if (!isListResponse(data)) return

        const httpContext = context.switchToHttp()
        const response = httpContext.getResponse<Response>()
        const request = httpContext.getRequest<Request>()

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
