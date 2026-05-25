import {
  ConflictException,
  type HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { DatabaseError } from 'pg'

/**
 * Map a `pg.DatabaseError` to an appropriate NestJS `HttpException`.
 *
 * Extracted from `all-exceptions.filter.ts` so the mapping table is
 * independently testable and so the filter stays under the 200-line
 * guideline.
 *
 * **Class coverage (Postgres SQLSTATE):**
 * - **Class 23 — Integrity Constraint Violation**
 *   - `23505` unique_violation → `409 Conflict` (RESOURCE_CONFLICT)
 *   - `23503` foreign_key_violation → `422` (CONSTRAINT_VIOLATION)
 *   - `23502` not_null_violation → `422` (CONSTRAINT_VIOLATION)
 *   - `23514` check_violation → `422` (CONSTRAINT_VIOLATION)
 * - **Class 08 — Connection Exception** (`08000/08001/08003/08004/08006`)
 *   → `503 Service Unavailable`. Transient — operators should retry.
 * - **Class 57 — Operator Intervention**
 *   - `57014` query_canceled (statement_timeout) → `503`
 * - Anything else → `500 Internal Server Error` with a generic message.
 *
 * @param error — the raw pg error caught at the driver boundary.
 * @returns an `HttpException` ready for the Problem Details filter to render.
 * @see {@link https://www.postgresql.org/docs/current/errcodes-appendix.html}
 *      — full Postgres error-class reference.
 */
export function mapDatabaseError(error: DatabaseError): HttpException {
  switch (error.code) {
    case '23505': {
      return new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'A resource with the same unique field already exists',
      })
    }
    case '23503': {
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Referenced resource does not exist',
      })
    }
    case '23502': {
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'A required field is missing',
      })
    }
    case '23514': {
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Data failed a database constraint check',
      })
    }
    case '08000':
    case '08003':
    case '08006':
    case '08001':
    case '08004': {
      return new ServiceUnavailableException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database connection error',
      })
    }
    case '57014': {
      return new ServiceUnavailableException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database query timed out',
      })
    }
    default: {
      return new InternalServerErrorException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected database error occurred',
      })
    }
  }
}
