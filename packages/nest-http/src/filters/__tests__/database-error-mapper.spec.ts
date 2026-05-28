import {
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'
import { mapDatabaseError } from '../database-error-mapper.js'

const dbError = (code: string): DatabaseError => ({ code }) as unknown as DatabaseError

describe('mapDatabaseError', () => {
  it('maps 23505 unique_violation to ConflictException(RESOURCE_CONFLICT)', () => {
    const err = mapDatabaseError(dbError('23505'))
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({ code: 'RESOURCE_CONFLICT' })
  })

  it('maps 23503 foreign_key_violation to UnprocessableEntityException(CONSTRAINT_VIOLATION)', () => {
    const err = mapDatabaseError(dbError('23503'))
    expect(err).toBeInstanceOf(UnprocessableEntityException)
    expect(err.getResponse()).toMatchObject({ code: 'CONSTRAINT_VIOLATION' })
  })

  it('maps 40001 serialization_failure to ConflictException(TRANSACTION_CONFLICT)', () => {
    const err = mapDatabaseError(dbError('40001'))
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({
      code: 'TRANSACTION_CONFLICT',
      message: expect.stringContaining('Transaction serialization conflict'),
    })
  })

  it('maps 40P01 deadlock_detected to ConflictException(TRANSACTION_CONFLICT)', () => {
    const err = mapDatabaseError(dbError('40P01'))
    expect(err).toBeInstanceOf(ConflictException)
    expect(err.getResponse()).toMatchObject({
      code: 'TRANSACTION_CONFLICT',
      message: expect.stringContaining('Deadlock detected'),
    })
  })

  it('maps 08006 connection_failure to ServiceUnavailableException', () => {
    const err = mapDatabaseError(dbError('08006'))
    expect(err).toBeInstanceOf(ServiceUnavailableException)
  })

  it('maps 57014 query_canceled to ServiceUnavailableException', () => {
    const err = mapDatabaseError(dbError('57014'))
    expect(err).toBeInstanceOf(ServiceUnavailableException)
  })

  it('maps unknown SQLSTATE to InternalServerErrorException', () => {
    const err = mapDatabaseError(dbError('99999'))
    expect(err).toBeInstanceOf(InternalServerErrorException)
    expect(err.getResponse()).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
  })
})
