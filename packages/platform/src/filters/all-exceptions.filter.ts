import { Catch, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DrizzleQueryError } from 'drizzle-orm'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'
import { DatabaseError } from 'pg'

import { ErrorCode } from '../error-codes'
import { mapDatabaseError } from './postgres-error-mapper'
import { ProblemDetailsFilter } from './problem-details.filter'

import type { Env } from '../config/env.schema'
import type { ProblemDetailsDto } from '../problem-details'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'

/**
 * Catch-all exception filter.
 *
 * - HttpException → delegate to ProblemDetailsFilter (RFC 9457)
 * - DrizzleQueryError(cause: pg.DatabaseError) → map to HttpException, then delegate
 * - everything else → 500 Problem Details with sanitized detail (production hides message)
 *
 * The cls/problemDetailsFilter/configService dependencies are `@Optional()`
 * so this filter remains usable in tests with a stripped DI graph.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    @Optional() private readonly cls?: ClsService,
    @Optional()
    @Inject(ProblemDetailsFilter)
    private readonly problemDetailsFilter?: ProblemDetailsFilter,
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {
    this.logger.setContext(AllExceptionsFilter.name)
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()

    if (exception instanceof HttpException && this.problemDetailsFilter) {
      this.problemDetailsFilter.catch(exception, host)
      return
    }

    if (exception instanceof DrizzleQueryError && this.problemDetailsFilter) {
      const cause = exception.cause
      if (cause instanceof DatabaseError) {
        const httpException = mapDatabaseError(cause)
        this.logger.warn(
          `[DB] code=${cause.code} table=${cause.table ?? 'unknown'} constraint=${cause.constraint ?? 'none'}`,
        )
        this.problemDetailsFilter.catch(httpException, host)
        return
      }
      // cause is not a pg.DatabaseError — fall through to 500
    }

    const status = HttpStatus.INTERNAL_SERVER_ERROR
    const isProduction = this.configService?.get('NODE_ENV', { infer: true }) === 'production'

    let message = 'Internal server error'
    if (exception instanceof Error) {
      message = isProduction ? 'The server encountered an unexpected error' : exception.message
    }

    const requestId = this.cls?.getId()
    const correlationId = this.cls?.get<string>('correlationId')
    const traceId = this.cls?.get<string>('traceId')

    const baseUrl = this.configService?.get('API_BASE_URL', { infer: true }) ?? 'about:blank'
    const problemDetails: ProblemDetailsDto = {
      type: baseUrl === 'about:blank' ? 'about:blank' : `${baseUrl}/errors/internal-server-error`,
      title: 'Internal Server Error',
      status,
      instance: request.url?.split('?')[0] ?? request.url,
      request_id: requestId,
      correlation_id: correlationId,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      detail: message,
    }

    const tracePrefix = this.buildTracePrefix(requestId, correlationId, traceId)
    const logMessage = `${tracePrefix}${request.method} ${request.url} ${status}`
    if (exception instanceof Error) {
      this.logger.error({ err: exception }, logMessage)
    } else {
      this.logger.error({ exception }, logMessage)
    }

    response.setHeader('Content-Type', 'application/problem+json')
    response.setHeader('Cache-Control', 'no-store')
    response.status(status).json(problemDetails)
  }

  private buildTracePrefix(requestId?: string, correlationId?: string, traceId?: string): string {
    const parts: string[] = []
    if (requestId) parts.push(`req:${requestId}`)
    if (correlationId) parts.push(`corr:${correlationId}`)
    if (traceId) parts.push(`trace:${traceId}`)
    return parts.length > 0 ? `[${parts.join('|')}] ` : ''
  }
}
