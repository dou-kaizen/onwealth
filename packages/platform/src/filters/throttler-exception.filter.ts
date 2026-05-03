import { Catch } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ThrottlerException } from '@nestjs/throttler'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

import type { Env } from '../config/env.schema'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { ProblemDetailsDto } from '@onwealth/contract'
import type { Request, Response } from 'express'

/**
 * Throttler exception filter.
 *
 * Spec:
 * - RFC 6585 §4 (429 Too Many Requests)
 * - IETF Rate Limit Headers draft
 *
 * Sets `Retry-After` + `X-RateLimit-*` and emits an RFC 9457 Problem
 * Details body. Dynamic from env so feature modules can tune via env
 * without owning rate-limit logic.
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService,
    private readonly configService: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ThrottlerExceptionFilter.name)
  }

  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()

    const ttl = Math.floor(this.configService.get('THROTTLE_TTL', { infer: true }) / 1000)
    const limit = this.configService.get('THROTTLE_LIMIT', { infer: true })
    const resetTime = Math.floor(Date.now() / 1000) + ttl

    response.setHeader('Retry-After', ttl.toString())
    response.setHeader('X-RateLimit-Limit', limit.toString())
    response.setHeader('X-RateLimit-Remaining', '0')
    response.setHeader('X-RateLimit-Reset', resetTime.toString())
    response.setHeader('Content-Type', 'application/problem+json')

    const problemDetails: ProblemDetailsDto = {
      type: `${this.configService.get('API_BASE_URL', { infer: true })}/errors/rate-limit-exceeded`,
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
