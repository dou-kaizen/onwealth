import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, HttpStatus, Inject, Logger, Optional } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { appConfig } from '@onwealth/shared-kernel'
import { DrizzleQueryError } from 'drizzle-orm'
import type { Request, Response } from 'express'
import { ClsService } from 'nestjs-cls'
import { DatabaseError } from 'pg'
import type { ProblemDetailsDto } from '../dtos/problem-details.dto.js'
import { mapDatabaseError } from './database-error-mapper.js'
import { ProblemDetailsFilter } from './problem-details.filter.js'

/**
 * Global exception filter
 *
 * Catches all unhandled exceptions, including non-HTTP exceptions.
 * Prevents sensitive error information from leaking to the client.
 *
 * For HTTP exceptions, delegates to ProblemDetailsFilter (RFC 9457 format).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  constructor(
    // Required: misconfigured DI must fail loudly at startup, not silently produce wrong status codes
    @Inject(ProblemDetailsFilter)
    private readonly problemDetailsFilter: ProblemDetailsFilter,
    @Optional() private readonly cls?: ClsService,
    @Optional()
    @Inject(appConfig.KEY)
    private readonly appCfg?: ConfigType<typeof appConfig>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()

    // For HTTP exceptions, delegate to ProblemDetailsFilter (RFC 9457 format)
    if (exception instanceof HttpException) {
      return this.problemDetailsFilter.catch(exception, host)
    }

    // Map Postgres DatabaseError to an appropriate HttpException, then re-delegate
    if (exception instanceof DrizzleQueryError) {
      const cause = exception.cause
      if (cause instanceof DatabaseError) {
        const httpException = mapDatabaseError(cause)
        this.logger.warn(
          `[DB] code=${cause.code} table=${cause.table ?? 'unknown'} constraint=${cause.constraint ?? 'none'}`,
        )
        return this.problemDetailsFilter.catch(httpException, host)
      }
      // M9: cause is NOT a pg.DatabaseError (rare — e.g. a driver-level wrap or
      // a network error). Log it before falling through to the generic 500 so
      // operators have a breadcrumb instead of a silent black hole.
      this.logger.warn('DrizzleQueryError with non-pg cause', {
        causeName: (cause as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown',
      })
    }

    // Only handle non-HTTP exceptions (system errors)
    const status = HttpStatus.INTERNAL_SERVER_ERROR

    // Default to true (prod-safe) when appConfig is absent to avoid leaking error.message
    const isProduction = this.appCfg ? this.appCfg.nodeEnv === 'production' : true
    let message = 'Internal server error'
    if (exception instanceof Error) {
      message = isProduction ? 'The server encountered an unexpected error' : exception.message
    }

    // Get tracing IDs
    const requestId = this.cls?.getId()
    const correlationId = this.cls?.get<string>('correlationId')
    const traceId = this.cls?.get<string>('traceId')

    // Build Problem Details response (RFC 9457 format).
    // RFC 9457 §3: use 'about:blank' when no specific documentation URI exists for the
    // error type. Non-HTTP system errors are unclassified — 'about:blank' is correct here;
    // it signals "no additional semantics beyond the HTTP status code".
    const problemDetails: ProblemDetailsDto = {
      type: 'about:blank',
      title: 'Internal Server Error',
      status,
      instance: request.url,
      request_id: requestId,
      correlation_id: correlationId,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      code: 'INTERNAL_SERVER_ERROR',
      detail: message,
    }

    // Build trace prefix for log message
    const tracePrefix = this.buildTracePrefix(requestId, correlationId, traceId)

    // Log full error stack
    const logMessage = `${tracePrefix}${request.method} ${request.url} ${status}`
    if (exception instanceof Error) {
      this.logger.error(logMessage, exception.stack)
    } else {
      this.logger.error(logMessage, JSON.stringify(exception))
    }

    // Set response headers (RFC 9457 recommended media type)
    response.setHeader('Content-Type', 'application/problem+json')
    // Prevent browsers from caching error responses
    response.setHeader('Cache-Control', 'no-store')

    response.status(status).json(problemDetails)
  }

  /**
   * Build trace ID prefix
   */
  private buildTracePrefix(requestId?: string, correlationId?: string, traceId?: string): string {
    const parts: string[] = []

    if (requestId) {
      parts.push(`req:${requestId}`)
    }
    if (correlationId) {
      parts.push(`corr:${correlationId}`)
    }
    if (traceId) {
      parts.push(`trace:${traceId}`)
    }

    return parts.length > 0 ? `[${parts.join('|')}] ` : ''
  }
}
