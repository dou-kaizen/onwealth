import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * A single error detail entry inside a {@link ProblemDetailsDto.errors} array.
 *
 * Two usage modes distinguished by the presence of `field` / `pointer`:
 * - **Field-level validation error** — `field`/`pointer` populated. Used by
 *   the `flattenValidationErrors` adapter when class-validator reports a
 *   per-property failure.
 * - **General error** — `field`/`pointer` absent. Used for cross-field or
 *   business-rule failures.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc6901.html} — JSON Pointer (RFC 6901)
 * @see {@link https://google.aip.dev/193} — Google AIP-193 error model
 */
export class FieldError {
  @ApiPropertyOptional({
    description: 'Field name (field-level validation error when present)',
    example: 'email',
  })
  field?: string

  @ApiPropertyOptional({
    description: 'JSON Pointer (RFC 6901) to the specific field',
    example: '/email',
  })
  pointer?: string

  @ApiProperty({
    description: 'Machine-readable error code (UPPER_SNAKE_CASE)',
    example: 'INVALID_EMAIL',
  })
  code: string

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'email must be a valid email address',
  })
  message: string

  @ApiPropertyOptional({
    description: 'Constraint details',
    example: { min: 8, max: 100, provided: 5 },
  })
  constraints?: Record<string, unknown>

  @ApiPropertyOptional({
    description: 'Expected format',
    example: 'user@domain.com',
  })
  expected_format?: string
}

/**
 * RFC 9457 Problem Details response shape returned by every error handler.
 *
 * **Field groupings:**
 * 1. **Core (RFC 9457 §3.1)** — `type`, `title`, `status`, `instance`. The
 *    `type` URI should dereference to human-readable documentation.
 * 2. **Tracing extensions** — `request_id`, `correlation_id`, `trace_id`,
 *    `timestamp`. Sourced from CLS context so error responses can be
 *    correlated with structured logs across services.
 * 3. **Business error extensions** — `code` (machine-readable),
 *    `detail` (human-readable). Set by the all-exceptions filter when the
 *    underlying error carries an {@link import('@boilerplate/shared-kernel').ErrorCode}.
 * 4. **Validation error extensions** — `errors[]`. Populated only when the
 *    underlying exception originated from class-validator.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9457.html} — RFC 9457
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description: 'Problem type URI, should be dereferenceable to human-readable documentation',
    example: 'https://api.example.com/errors/validation-failed',
  })
  type: string

  @ApiProperty({
    description: 'Short human-readable summary',
    example: 'Unprocessable Entity',
  })
  title: string

  @ApiProperty({
    description: 'HTTP status code',
    example: 422,
  })
  status: number

  @ApiPropertyOptional({
    description: 'URI reference where the problem occurred',
    example: '/api/users',
  })
  instance?: string

  @ApiPropertyOptional({
    description: 'Request tracing ID',
    example: 'req_xyz789',
  })
  request_id?: string

  @ApiPropertyOptional({
    description: 'Correlation ID (business transaction tracing)',
    example: 'corr_shop_session_abc123',
  })
  correlation_id?: string

  @ApiPropertyOptional({
    description: 'Distributed tracing ID (W3C Trace Context)',
    example: '4bf92f3577b34da6a3ce929d0e0e4736',
  })
  trace_id?: string

  @ApiPropertyOptional({
    description: 'Time the error occurred (ISO 8601 format)',
    example: '2024-11-03T10:30:00Z',
  })
  timestamp?: string

  @ApiPropertyOptional({
    description: 'Machine-readable error code (business errors only)',
    example: 'INVALID_CREDENTIALS',
  })
  code?: string

  @ApiPropertyOptional({
    description: 'Human-readable detail for this specific request occurrence',
    example: 'Invalid email or password',
  })
  detail?: string

  /**
   * Field-level error details. Populated by `flattenValidationErrors`
   * for class-validator failures.
   *
   * May degrade to `string[]` when a controller throws
   * `new BadRequestException([...])` with raw messages instead of a
   * structured class-validator payload — RFC 9457 §3.2 permits the
   * extension to carry either shape.
   */
  @ApiPropertyOptional({
    description:
      'Field-level error details (validation errors only; absent for business/system errors). ' +
      'May also be a plain string[] when the controller threw `new BadRequestException([...])` ' +
      'with raw messages instead of a structured class-validator payload (RFC 9457 §3.2 extension).',
    type: [FieldError],
    example: [
      {
        field: 'email',
        pointer: '/email',
        code: 'INVALID_EMAIL',
        message: 'email must be a valid email address',
      },
    ],
  })
  errors?: FieldError[] | string[]
}
