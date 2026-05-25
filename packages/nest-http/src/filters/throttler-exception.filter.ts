import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, Inject, Logger } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ThrottlerException } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { ClsService } from 'nestjs-cls'
import { httpConfig } from '../config/http.config.js'
import { throttleConfig } from '../config/throttle.config.js'
import type { ProblemDetailsDto } from '../dtos/problem-details.dto.js'

/**
 * Specialised filter for `@nestjs/throttler` rate-limit failures.
 *
 * Renders the RFC 9457 Problem Details body and attaches the headers
 * standard clients expect on a 429 response:
 * - `Retry-After` (RFC 6585 §4, mandatory). Set to the full TTL window
 *   in seconds — `@nestjs/throttler` does not surface the offending
 *   bucket's exact time-to-reset, so the full TTL is the safe upper
 *   bound a client can back off to without hammering.
 * - `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
 *   per the IETF rate-limit-headers draft.
 *
 * Registered before {@link AllExceptionsFilter} because the catch-all
 * would otherwise swallow `ThrottlerException` and miss the headers.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc6585.html#section-4}
 *      — RFC 6585 §4 (429 Too Many Requests)
 * @see {@link https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers}
 *      — IETF rate-limit-headers draft
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ThrottlerExceptionFilter.name)

  constructor(
    private readonly cls: ClsService,
    @Inject(throttleConfig.KEY) private readonly throttleCfg: ConfigType<typeof throttleConfig>,
    @Inject(httpConfig.KEY) private readonly httpCfg: ConfigType<typeof httpConfig>,
  ) {}

  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()

    const ttl = Math.floor(this.throttleCfg.ttl / 1000)
    const limit = this.throttleCfg.limit
    const resetTime = Math.floor(Date.now() / 1000) + ttl

    response.setHeader('Retry-After', ttl.toString())
    response.setHeader('X-RateLimit-Limit', limit.toString())
    response.setHeader('X-RateLimit-Remaining', '0')
    response.setHeader('X-RateLimit-Reset', resetTime.toString())
    response.setHeader('Content-Type', 'application/problem+json')

    const problemDetails: ProblemDetailsDto = {
      type: `${this.httpCfg.apiBaseUrl}/errors/rate-limit-exceeded`,
      title: 'Too Many Requests',
      status: 429,
      instance: request.url,
      request_id: this.cls.getId(),
      correlation_id: this.cls.get('correlationId'),
      trace_id: this.cls.get('traceId'),
      timestamp: new Date().toISOString(),
      errors: [
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `You have sent ${limit} requests within ${ttl} seconds. Please try again later.`,
          constraints: {
            limit,
            remaining: 0,
            reset: resetTime,
          },
        },
      ],
    }

    this.logger.warn(`Rate limit exceeded: ${request.method} ${request.url} - ${request.ip}`)
    response.status(429).json(problemDetails)
  }
}
