import { Catch, HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ClsService } from 'nestjs-cls'
import { PinoLogger } from 'nestjs-pino'

import { ErrorCode } from '../error-codes'

import type { Env } from '../config/env.schema'
import type { FieldError, ProblemDetailsDto, ValidationErrorItem } from '../problem-details'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'

/**
 * RFC 9457 Problem Details exception filter.
 *
 * Spec: https://www.rfc-editor.org/rfc/rfc9457.html
 *
 * - Maps any `HttpException` to standard Problem Details JSON
 * - Extracts class-validator field errors when present
 * - Stamps `request_id`, `correlation_id`, `trace_id` from CLS so
 *   client errors stay correlatable to server logs.
 */
@Catch(HttpException)
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly cls: ClsService,
    private readonly configService: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProblemDetailsFilter.name)
  }

  /**
   * Paths to suppress logging — typically frontend service-worker probes
   * that pollute logs with predictable 404s.
   */
  readonly #silentPaths = ['/mockServiceWorker.js']

  catch(exception: HttpException, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    const request = context.getRequest<Request>()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    if (status === 404 && this.#silentPaths.includes(request.url)) {
      response.status(404).end()
      return
    }

    const errorPayload = this.buildErrorPayload(
      exceptionResponse as string | Record<string, unknown>,
      exception,
      status,
    )
    const problemDetails: ProblemDetailsDto = {
      type: this.getTypeUri(status),
      title: this.getTitle(status, exception),
      status,
      instance: request.url,
      request_id: this.cls.getId(),
      correlation_id: this.cls.get('correlationId'),
      trace_id: this.cls.get('traceId'),
      timestamp: new Date().toISOString(),
      ...errorPayload,
    }

    const logMessage = `${request.method} ${request.url} ${status}`
    if (status >= 500) {
      this.logger.error({ err: exception }, logMessage)
    } else {
      this.logger.warn(logMessage)
    }

    response.setHeader('Content-Type', 'application/problem+json')
    response.setHeader('Cache-Control', 'no-store')
    response.status(status).json(problemDetails)
  }

  private getTypeUri(status: number): string {
    const baseUrl = this.configService.get('API_BASE_URL', { infer: true })
    return `${baseUrl}/errors/${this.getErrorType(status)}`
  }

  private getErrorType(status: number): string {
    const typeMap: Record<number, string> = {
      400: 'bad-request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not-found',
      408: 'request-timeout',
      409: 'conflict',
      422: 'validation-failed',
      429: 'rate-limit-exceeded',
      500: 'internal-server-error',
      502: 'bad-gateway',
      503: 'service-unavailable',
      504: 'gateway-timeout',
    }
    return typeMap[status] ?? 'unknown-error'
  }

  private getTitle(status: number, exception: HttpException): string {
    const titleMap: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      408: 'Request Timeout',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    }
    return titleMap[status] ?? exception.name
  }

  /**
   * Build code/detail/errors payload.
   *
   * Strategy:
   *   1. validation errors (400/422 with field data) → code/detail + errors[]
   *   2. business errors (response carries `code`)   → code/detail
   *   3. fallback                                    → mapped code by status
   */
  private buildErrorPayload(
    exceptionResponse: string | Record<string, unknown>,
    exception: HttpException,
    status: number,
  ): { code: string; detail: string; errors?: FieldError[] } {
    if (status === 400 || status === 422) {
      const validationErrors = this.extractValidationErrors(exceptionResponse)
      if (validationErrors && validationErrors.length > 0) {
        return {
          code: ErrorCode.VALIDATION_FAILED,
          detail: 'Request validation failed',
          errors: validationErrors,
        }
      }
    }

    if (typeof exceptionResponse === 'object' && 'code' in exceptionResponse) {
      const code = exceptionResponse.code as string
      const msg = exceptionResponse.message
      const detail = typeof msg === 'string' ? msg : exception.message
      return { code, detail }
    }

    const detail = typeof exceptionResponse === 'string' ? exceptionResponse : exception.message
    const fallbackCodeMap: Record<number, ErrorCode> = {
      401: ErrorCode.UNAUTHORIZED,
      403: ErrorCode.FORBIDDEN,
      404: ErrorCode.RESOURCE_NOT_FOUND,
      408: ErrorCode.REQUEST_TIMEOUT,
      409: ErrorCode.RESOURCE_CONFLICT,
      429: ErrorCode.RATE_LIMIT_EXCEEDED,
    }
    const code =
      status >= 500
        ? ErrorCode.INTERNAL_SERVER_ERROR
        : (fallbackCodeMap[status] ?? ErrorCode.BAD_REQUEST)
    return { code, detail }
  }

  private extractValidationErrors(
    exceptionResponse: string | Record<string, unknown>,
  ): FieldError[] | undefined {
    if (
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse &&
      Array.isArray(exceptionResponse.message)
    ) {
      const errors: FieldError[] = []

      for (const item of exceptionResponse.message) {
        if (typeof item === 'string') {
          // Legacy string form: "<field> <message...>"
          const parts = item.split(' ')
          const field = parts[0] ?? 'unknown'
          errors.push({
            field,
            pointer: `/${field}`,
            code: ErrorCode.VALIDATION_ERROR,
            message: item,
          })
        } else if (this.isValidationErrorItem(item)) {
          // Structured class-validator form
          const field = item.property
          const constraints = item.constraints ?? {}
          const contexts = item.contexts ?? {}

          for (const [constraintName, message] of Object.entries(constraints)) {
            const contextCode = contexts[constraintName]?.code
            errors.push({
              field,
              pointer: `/${field}`,
              code: contextCode ?? ErrorCode.VALIDATION_ERROR,
              message,
            })
          }
        }
      }

      return errors.length > 0 ? errors : undefined
    }

    return undefined
  }

  private isValidationErrorItem(item: unknown): item is ValidationErrorItem {
    return (
      typeof item === 'object' &&
      item !== null &&
      'property' in item &&
      typeof (item as ValidationErrorItem).property === 'string'
    )
  }
}
