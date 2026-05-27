/**
 * Application error-code vocabulary used in RFC 9457 problem-details responses.
 *
 * Codes here populate the `code` field on `ProblemDetailsDto` so API clients
 * can branch on a stable machine-readable identifier rather than HTTP status
 * alone.
 *
 * **YAGNI:** only codes referenced by the current infrastructure layer are
 * listed. Domain-specific codes (e.g. `ORDER_NOT_FOUND`) ship alongside their
 * feature module when that domain actually lands — not pre-declared here.
 *
 * **Groupings:**
 * - Validation — emitted by class-validator decorators in `@boilerplate/nest-http`.
 * - Resource — 404/409 mapping for repository lookups + uniqueness conflicts.
 * - Constraint — Postgres `23xxx` SQLSTATE family mapped to a single code.
 * - Authorization — 401/403 split.
 * - General — broad fallbacks for status families without a more specific code.
 */
export const ErrorCode = {
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_UUID: 'INVALID_UUID',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_LENGTH: 'INVALID_LENGTH',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  /** FK violation (23503), not-null violation (23502), check violation (23514). */
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',

  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  BAD_REQUEST: 'BAD_REQUEST',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
