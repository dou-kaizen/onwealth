import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'

import type { DatabaseError } from 'pg'

/**
 * Map a `pg.DatabaseError` to an HTTP exception.
 *
 * Postgres SQLSTATE reference:
 *   https://www.postgresql.org/docs/current/errcodes-appendix.html
 *
 * Class 23 (integrity violations) maps to 4xx; class 08 (connection) and
 * 57014 (query_canceled / statement_timeout) map to 503.
 */
export function mapDatabaseError(error: DatabaseError): HttpException {
  switch (error.code) {
    // Class 23 — Integrity Constraint Violation
    case '23505': {
      return new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'A resource with the same unique field already exists',
      })
    }
    case '23503': {
      return new UnprocessableEntityException({
        code: 'RESOURCE_CONFLICT',
        message: 'Referenced resource does not exist',
      })
    }
    case '23502': {
      return new UnprocessableEntityException({
        code: 'RESOURCE_CONFLICT',
        message: 'A required field is missing',
      })
    }
    case '23514': {
      return new UnprocessableEntityException({
        code: 'RESOURCE_CONFLICT',
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
    // Class 57 — Operator Intervention (e.g. statement_timeout)
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
