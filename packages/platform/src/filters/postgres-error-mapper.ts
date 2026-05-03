import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'

import { ErrorCode } from '../error-codes'

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
        code: ErrorCode.RESOURCE_CONFLICT,
        message: 'A resource with the same unique field already exists',
      })
    }
    case '23503': {
      return new UnprocessableEntityException({
        code: ErrorCode.RESOURCE_CONFLICT,
        message: 'Referenced resource does not exist',
      })
    }
    case '23502': {
      return new UnprocessableEntityException({
        code: ErrorCode.REQUIRED_FIELD,
        message: 'A required field is missing',
      })
    }
    case '23514': {
      return new UnprocessableEntityException({
        code: ErrorCode.RESOURCE_CONFLICT,
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
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Database connection error',
      })
    }
    // Class 57 — Operator Intervention (e.g. statement_timeout)
    case '57014': {
      return new ServiceUnavailableException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Database query timed out',
      })
    }
    default: {
      return new InternalServerErrorException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'An unexpected database error occurred',
      })
    }
  }
}
