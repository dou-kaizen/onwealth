import type { ValidationErrorItem } from '@boilerplate/shared-kernel'
import { flattenValidationErrors } from '@boilerplate/shared-kernel'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import { Catch, HttpException, Inject, Logger } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Request, Response } from 'express'
import { ClsService } from 'nestjs-cls'
import { httpConfig } from '../config/http.config.js'
import type { FieldError, ProblemDetailsDto } from '../dtos/problem-details.dto.js'

/**
 * RFC 9457 Problem Details renderer for every `HttpException`.
 *
 * **Responsibilities:**
 * - Map status code → canonical `type` URI + `title`.
 * - Surface tracing IDs (`request_id`/`correlation_id`/`trace_id`) from CLS.
 * - Translate class-validator failures into the structured `errors[]` array.
 * - Translate `BadRequestException(['…'])` array payloads (which would
 *   otherwise be silently dropped) into a usable `errors` field.
 * - Emit `Content-Type: application/problem+json` + `Cache-Control: no-store`.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9457.html} — RFC 9457
 */
@Catch(HttpException)
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name)

  constructor(
    private readonly cls: ClsService,
    @Inject(httpConfig.KEY) private readonly httpCfg: ConfigType<typeof httpConfig>,
  ) {}

  /**
   * Paths suppressed from access logs — typically dev tooling probes
   * (e.g. MSW service-worker file) that would otherwise pollute logs
   * with 404 noise.
   */
  readonly #silentPaths = ['/mockServiceWorker.js']

  catch(exception: HttpException, host: ArgumentsHost) {
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
      exceptionResponse as string | Record<string, unknown> | unknown[],
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
      this.logger.error(logMessage, exception.stack)
    } else {
      this.logger.warn(logMessage)
    }

    response.setHeader('Content-Type', 'application/problem+json')
    response.setHeader('Cache-Control', 'no-store')
    response.status(status).json(problemDetails)
  }

  /**
   * Resolve the RFC 9457 `type` URI for a given status code.
   *
   * RFC 9457 §4.1 reserves `about:blank` for cases without a canonical
   * type URI — used here for statuses outside the mapped allowlist so we
   * never fabricate a fake `/errors/unknown` documentation link.
   */
  private getTypeUri(status: number): string {
    const errorType = this.getErrorType(status)
    if (errorType === 'about:blank') return 'about:blank'
    const baseUrl = this.httpCfg.apiBaseUrl
    return `${baseUrl}/errors/${errorType}`
  }

  /** Map status code → kebab-case error slug used in the `type` URI path. */
  private getErrorType(status: number): string {
    const typeMap: Record<number, string> = {
      400: 'bad-request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not-found',
      409: 'conflict',
      422: 'validation-failed',
      429: 'rate-limit-exceeded',
      500: 'internal-server-error',
      502: 'bad-gateway',
      503: 'service-unavailable',
      504: 'gateway-timeout',
    }
    return typeMap[status] ?? 'about:blank'
  }

  /**
   * Resolve the short human-readable `title` (RFC 9457 §3.1.2).
   *
   * Falls back to `exception.name` for unmapped statuses so callers still
   * get a meaningful identifier instead of an empty string.
   */
  private getTitle(status: number, exception: HttpException): string {
    const titleMap: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
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
   * Assemble the `code`/`detail`/`errors` fields based on the shape of
   * the exception response body.
   *
   * **Strategy (first match wins):**
   * 1. **Validation** (400/422 with structured class-validator items) →
   *    `VALIDATION_FAILED` + flattened field-level `errors[]`.
   * 2. **Array body** (`new BadRequestException(['a','b'])`) → preserved
   *    as `string[]` in `errors`. Without this branch, `'code' in arr`
   *    returns false and the payload is silently dropped, leaving the
   *    client with only `exception.message`.
   * 3. **Business error** with explicit `{ code, message }` body → forwarded
   *    verbatim.
   * 4. **Fallback** → status → code map (`UNAUTHORIZED`, `FORBIDDEN`, …)
   *    with `INTERNAL_SERVER_ERROR` for any 5xx.
   */
  private buildErrorPayload(
    exceptionResponse: string | Record<string, unknown> | unknown[],
    exception: HttpException,
    status: number,
  ): Pick<ProblemDetailsDto, 'code' | 'detail' | 'errors'> {
    if (status === 400 || status === 422) {
      const validationErrors = this.extractValidationErrors(exceptionResponse)
      if (validationErrors && validationErrors.length > 0) {
        return {
          code: 'VALIDATION_FAILED',
          detail: 'Request validation failed',
          errors: validationErrors,
        }
      }
    }

    if (Array.isArray(exceptionResponse)) {
      return {
        code: status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
        detail: exception.message,
        errors: exceptionResponse.map(String),
      }
    }

    if (typeof exceptionResponse === 'object' && 'code' in exceptionResponse) {
      const code = exceptionResponse.code as string
      const msg = exceptionResponse.message
      const detail = typeof msg === 'string' ? msg : exception.message
      return { code, detail }
    }

    const detail = typeof exceptionResponse === 'string' ? exceptionResponse : exception.message
    const fallbackCodeMap: Record<number, string> = {
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'RESOURCE_NOT_FOUND',
      409: 'RESOURCE_CONFLICT',
      429: 'RATE_LIMIT_EXCEEDED',
    }
    const code =
      status >= 500 ? 'INTERNAL_SERVER_ERROR' : (fallbackCodeMap[status] ?? 'BAD_REQUEST')
    return { code, detail }
  }

  /**
   * Convert a class-validator failure payload into structured
   * {@link FieldError} entries.
   *
   * Handles both shapes encountered in practice:
   * - **Legacy string form** (`"email must be an email"`) — split on
   *   whitespace; the first token is treated as the field name. No
   *   nesting possible.
   * - **Structured `ValidationErrorItem`** — passed through
   *   {@link flattenValidationErrors} so nested DTO failures
   *   (`address.street.zip`) emit dotted property paths instead of
   *   being dropped on the top-level scan.
   *
   * Returns `undefined` when the shape does not look like a validation
   * payload, so callers can fall back to other branches.
   */
  private extractValidationErrors(
    exceptionResponse: string | Record<string, unknown> | unknown[],
  ): FieldError[] | undefined {
    if (
      typeof exceptionResponse !== 'object' ||
      exceptionResponse === null ||
      Array.isArray(exceptionResponse) ||
      !('message' in exceptionResponse) ||
      !Array.isArray(exceptionResponse.message)
    ) {
      return undefined
    }

    const errors: FieldError[] = []
    const structuredItems: ValidationErrorItem[] = []

    for (const item of exceptionResponse.message) {
      if (typeof item === 'string') {
        const parts = item.split(' ')
        const field = parts[0] ?? 'unknown'
        errors.push({
          field,
          pointer: `/${field}`,
          code: 'VALIDATION_ERROR',
          message: item,
        })
      } else if (this.isValidationErrorItem(item)) {
        structuredItems.push(item)
      }
    }

    for (const flat of flattenValidationErrors(structuredItems)) {
      errors.push({
        field: flat.property,
        pointer: `/${flat.property.replaceAll('.', '/')}`,
        code: flat.code ?? 'VALIDATION_ERROR',
        message: flat.message,
      })
    }

    return errors.length > 0 ? errors : undefined
  }

  /** Type guard for the structured class-validator error item shape. */
  private isValidationErrorItem(item: unknown): item is ValidationErrorItem {
    return (
      typeof item === 'object' &&
      item !== null &&
      'property' in item &&
      typeof (item as ValidationErrorItem).property === 'string'
    )
  }
}
