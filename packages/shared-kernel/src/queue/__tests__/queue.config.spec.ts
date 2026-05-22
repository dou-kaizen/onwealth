import { describe, expect, it } from 'vitest'
import { queueEnvSchema } from '../queue.config.js'

const BASE = { REDIS_URL: 'redis://localhost:6379' }

describe('queueEnvSchema', () => {
  it('accepts REDIS_URL alone — QUEUE_REDIS_URL is optional', () => {
    const result = queueEnvSchema.safeParse(BASE)
    expect(result.success).toBe(true)
  })

  it('accepts a valid QUEUE_REDIS_URL alongside REDIS_URL', () => {
    const result = queueEnvSchema.safeParse({
      ...BASE,
      QUEUE_REDIS_URL: 'redis://queue-host:6380',
    })
    expect(result.success).toBe(true)
  })

  it('rejects QUEUE_REDIS_URL with invalid scheme', () => {
    const result = queueEnvSchema.safeParse({
      ...BASE,
      QUEUE_REDIS_URL: 'http://not-redis',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing REDIS_URL', () => {
    const result = queueEnvSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('resolves effective URL to QUEUE_REDIS_URL when present', () => {
    // Test the factory logic by calling parse + ?? fallback inline
    // (queueConfig factory runs process.env; we test the schema subset here)
    const env = queueEnvSchema.parse({
      ...BASE,
      QUEUE_REDIS_URL: 'redis://dedicated:6381',
    })
    const effectiveUrl = env.QUEUE_REDIS_URL ?? env.REDIS_URL
    expect(effectiveUrl).toBe('redis://dedicated:6381')
  })

  it('falls back to REDIS_URL when QUEUE_REDIS_URL absent', () => {
    const env = queueEnvSchema.parse(BASE)
    const effectiveUrl = env.QUEUE_REDIS_URL ?? env.REDIS_URL
    expect(effectiveUrl).toBe('redis://localhost:6379')
  })
})

// [Validation Q2] Covers the prod-TLS superRefine guard added by Red Team H1.
// NODE_ENV defaults to 'development' (so the BASE tests above stay green); these
// cases drive NODE_ENV explicitly to exercise the production branch.
describe('queueEnvSchema — production TLS guard', () => {
  it('rejects plain redis:// REDIS_URL in production', () => {
    const result = queueEnvSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
    })
    expect(result.success).toBe(false)
  })

  it('accepts rediss:// REDIS_URL in production', () => {
    const result = queueEnvSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://localhost:6379',
    })
    expect(result.success).toBe(true)
  })

  it('rejects plain redis:// QUEUE_REDIS_URL in production even when REDIS_URL is TLS', () => {
    const result = queueEnvSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'rediss://localhost:6379',
      QUEUE_REDIS_URL: 'redis://queue-host:6380',
    })
    expect(result.success).toBe(false)
  })

  it('allows plain redis:// outside production', () => {
    const result = queueEnvSchema.safeParse({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://localhost:6379',
    })
    expect(result.success).toBe(true)
  })
})
