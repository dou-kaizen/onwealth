import {
  ConflictException,
  type HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { DatabaseError } from 'pg'

/**
 * Maps a pg DatabaseError to a NestJS HttpException.
 *
 * Postgres error class reference:
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 *
 * Extracted from all-exceptions.filter.ts (M24) to keep the filter under the
 * 200-line guideline and to make the mapping rules independently testable.
 */
export function mapDatabaseError(error: DatabaseError): HttpException {
  switch (error.code) {
    // Class 23 — Integrity Constraint Violation
    case '23505': {
      // unique_violation
      return new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'A resource with the same unique field already exists',
      })
    }
    case '23503': {
      // foreign_key_violation — referenced row does not exist; this is a data
      // integrity constraint, not a uniqueness conflict (23505).
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Referenced resource does not exist',
      })
    }
    case '23502': {
      // not_null_violation — a required column was omitted; integrity constraint.
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'A required field is missing',
      })
    }
    case '23514': {
      // check_violation — data failed a CHECK constraint; integrity constraint.
      return new UnprocessableEntityException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Data failed a database constraint check',
      })
    }
    // Class 08 — Connection Exception
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
    // Class 57 — Operator Intervention (e.g. query_canceled, admin_shutdown)
    case '57014': {
      // query_canceled (e.g. statement_timeout)
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
