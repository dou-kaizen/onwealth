/**
 * Application error-code vocabulary used in RFC 9457 problem-details responses.
 *
 * YAGNI: only codes referenced by the current infrastructure layer are listed.
 * Domain-specific codes (e.g. ORDER_NOT_FOUND) are added alongside their
 * feature module when that domain actually lands — not pre-declared here.
 */
export const ErrorCode = {
  // Validation — emitted by class-validator decorators in @onwealth/nest-http
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_UUID: 'INVALID_UUID',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_LENGTH: 'INVALID_LENGTH',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // Resource
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  // FK violation (23503), not-null violation (23502), check violation (23514)
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  // Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  // General
  BAD_REQUEST: 'BAD_REQUEST',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
