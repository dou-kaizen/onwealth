import { describe, expect, it } from 'vitest'
import { databaseEnvSchema } from '../database.config.js'
import { envSchema } from '../env.schema.js'

/**
 * Regression tests for DB_POOL_MIN > DB_POOL_MAX cross-field validation.
 *
 * Both envSchema and databaseEnvSchema declare independent pool min/max fields
 * and each must reject the inconsistent configuration. databaseEnvSchema is
 * parsed by non-HTTP workers that skip the full envSchema, so both must carry
 * the guard independently.
 */

/** Minimal valid base env for envSchema tests */
const BASE_ENV = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'at-least-32-characters-long-secret-key!!',
  API_BASE_URL: 'https://api.example.com',
}

/** Minimal valid base env for databaseEnvSchema tests */
const BASE_DB_ENV = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
}

describe('envSchema — pool min/max cross-field validation', () => {
  it('accepts valid config where DB_POOL_MIN < DB_POOL_MAX', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      DB_POOL_MIN: '5',
      DB_POOL_MAX: '20',
    })
    expect(result.success).toBe(true)
  })

  it('accepts equal DB_POOL_MIN and DB_POOL_MAX', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      DB_POOL_MIN: '10',
      DB_POOL_MAX: '10',
    })
    expect(result.success).toBe(true)
  })

  it('rejects DB_POOL_MIN > DB_POOL_MAX with a clear message on DB_POOL_MIN', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      DB_POOL_MIN: '50',
      DB_POOL_MAX: '10',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('DB_POOL_MIN'))
      expect(issue).toBeDefined()
      expect(issue?.message).toMatch(/DB_POOL_MIN.*DB_POOL_MAX/)
    }
  })
})

describe('databaseEnvSchema — pool min/max cross-field validation', () => {
  it('accepts valid config where DB_POOL_MIN < DB_POOL_MAX', () => {
    const result = databaseEnvSchema.safeParse({
      ...BASE_DB_ENV,
      DB_POOL_MIN: '5',
      DB_POOL_MAX: '20',
    })
    expect(result.success).toBe(true)
  })

  it('accepts equal DB_POOL_MIN and DB_POOL_MAX', () => {
    const result = databaseEnvSchema.safeParse({
      ...BASE_DB_ENV,
      DB_POOL_MIN: '10',
      DB_POOL_MAX: '10',
    })
    expect(result.success).toBe(true)
  })

  it('rejects DB_POOL_MIN > DB_POOL_MAX with a clear message on DB_POOL_MIN', () => {
    const result = databaseEnvSchema.safeParse({
      ...BASE_DB_ENV,
      DB_POOL_MIN: '50',
      DB_POOL_MAX: '10',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('DB_POOL_MIN'))
      expect(issue).toBeDefined()
      expect(issue?.message).toMatch(/DB_POOL_MIN.*DB_POOL_MAX/)
    }
  })
})
