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
      // FK violation: the REFERENCED row is missing — semantically a not-found,
      // not a conflict. Status remains 422 (the request itself is well-formed).
      //
      // NOTE on the (RESOURCE_NOT_FOUND, 422) pairing: client SDKs that key
      // off `code` alone may assume 404 semantics. The pairing is intentional
      // — see docs/code-standards.md "DB error mapping" — and clients MUST
      // branch on `status` first, `code` second. If a future feature module
      // needs an unambiguous symbol it should introduce a domain-specific
      // code (e.g. `REFERENCE_NOT_FOUND`) rather than overload this one.
      return new UnprocessableEntityException({
        code: ErrorCode.RESOURCE_NOT_FOUND,
        message: 'The referenced resource does not exist',
      })
    }
    case '23502': {
      return new UnprocessableEntityException({
        code: ErrorCode.REQUIRED_FIELD,
        message: 'A required field is missing',
      })
    }
    case '23514': {
      // Check constraint failure — distinct from RESOURCE_CONFLICT (which is
      // unique-violation territory). Use a dedicated code so clients can
      // surface "value violates a domain rule" UX.
      return new UnprocessableEntityException({
        code: ErrorCode.CONSTRAINT_VIOLATION,
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
