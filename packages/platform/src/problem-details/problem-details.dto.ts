/* oxlint-disable max-classes-per-file -- FieldError + ProblemDetailsDto co-located: nested type referenced via `type: [FieldError]` decorator. Splitting would create cross-file coupling for no benefit. */
import { ApiProperty } from '@nestjs/swagger'

/**
 * RFC 9457 Problem Details types
 *
 * Spec: https://www.rfc-editor.org/rfc/rfc9457.html
 *
 * Class form (not interface) — required for `@nestjs/swagger`
 * `extraModels` registration. Decorators capture runtime metadata
 * for OpenAPI schema generation.
 *
 * Consumers use via `import type` (filters) — class doubles as type.
 */

/**
 * Field-level error detail
 *
 * Spec:
 * - JSON Pointer (RFC 6901): https://www.rfc-editor.org/rfc/rfc6901.html
 * - Google AIP-193 error model: https://google.aip.dev/193
 *
 * Usage:
 * - `field` present → field-level validation error (e.g. invalid email)
 * - `field` absent → general error (e.g. business rule, system error)
 */
export class FieldError {
  @ApiProperty({ required: false, description: 'Field name (dot notation for nested)' })
  field?: string

  @ApiProperty({ required: false, description: 'JSON Pointer (RFC 6901) to the offending field' })
  pointer?: string

  @ApiProperty({ description: 'Machine-readable code (UPPER_SNAKE_CASE)' })
  code!: string

  @ApiProperty({ description: 'Human-readable error description' })
  message!: string

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: true,
    description: 'Validator constraints metadata',
  })
  constraints?: Record<string, unknown>

  @ApiProperty({ required: false, description: 'Expected format hint' })
  expected_format?: string
}

/**
 * RFC 9457 Problem Details payload shape
 *
 * Core fields (RFC 9457 standard):
 * - type: problem type URI
 * - title: short human-readable summary
 * - status: HTTP status code
 * - instance: URI reference where the problem occurred
 *
 * Extension fields:
 * - request_id, correlation_id, trace_id: tracing IDs
 * - timestamp: ISO-8601 occurrence time
 * - code: machine-readable code (UPPER_SNAKE_CASE)
 * - detail: human-readable description for this occurrence
 * - errors: field-level error details (validation only)
 */
export class ProblemDetailsDto {
  @ApiProperty({ description: 'Problem type URI', example: 'about:blank' })
  type!: string

  @ApiProperty({ description: 'Short human-readable summary', example: 'Validation Failed' })
  title!: string

  @ApiProperty({ description: 'HTTP status code', example: 422 })
  status!: number

  @ApiProperty({ required: false, description: 'URI reference where the problem occurred' })
  instance?: string

  @ApiProperty({ required: false, description: 'Per-request trace ID' })
  request_id?: string

  @ApiProperty({ required: false, description: 'Cross-service correlation ID' })
  correlation_id?: string

  @ApiProperty({ required: false, description: 'W3C distributed trace ID' })
  trace_id?: string

  @ApiProperty({ required: false, description: 'ISO-8601 occurrence time' })
  timestamp?: string

  @ApiProperty({
    required: false,
    description: 'Machine-readable code',
    example: 'VALIDATION_FAILED',
  })
  code?: string

  @ApiProperty({ required: false, description: 'Human-readable description for this occurrence' })
  detail?: string

  @ApiProperty({
    required: false,
    type: [FieldError],
    description: 'Field-level error details (validation only)',
  })
  errors?: FieldError[]
}
