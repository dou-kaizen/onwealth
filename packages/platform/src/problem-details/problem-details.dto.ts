/**
 * RFC 9457 Problem Details types
 *
 * Spec: https://www.rfc-editor.org/rfc/rfc9457.html
 *
 * Pure data shapes — no framework annotations. Consumed by
 * @onwealth/platform/filters when building HTTP error responses.
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
export interface FieldError {
  field?: string
  pointer?: string
  code: string
  message: string
  constraints?: Record<string, unknown>
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
export interface ProblemDetailsDto {
  type: string
  title: string
  status: number
  instance?: string

  request_id?: string
  correlation_id?: string
  trace_id?: string
  timestamp?: string

  code?: string
  detail?: string

  errors?: FieldError[]
}
