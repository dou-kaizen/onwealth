import { registerAs } from '@nestjs/config'
import { envObjectSchema } from '../config/env.schema.js'

/**
 * Queue env subset — validates only the queue slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` (single source of truth
 * for field shapes). The prod-TLS cross-field guard is re-chained below because
 * `.pick()` drops the parent `envSchema.superRefine()`.
 *
 * Falls back to REDIS_URL when QUEUE_REDIS_URL is absent.
 */
export const queueEnvSchema = envObjectSchema
  .pick({
    NODE_ENV: true,
    REDIS_URL: true,
    QUEUE_REDIS_URL: true,
  })
  .superRefine((data, ctx) => {
    const isProd = data.NODE_ENV === 'production'
    if (!isProd) return
    const effectiveUrl = data.QUEUE_REDIS_URL ?? data.REDIS_URL
    if (effectiveUrl.startsWith('redis://')) {
      ctx.addIssue({
        code: 'custom',
        path: [data.QUEUE_REDIS_URL ? 'QUEUE_REDIS_URL' : 'REDIS_URL'],
        message: 'Queue Redis URL must use rediss:// (TLS) in production',
      })
    }
  })

/**
 * Typed `queue` namespace config factory.
 *
 * Resolves the effective Redis URL: QUEUE_REDIS_URL takes precedence,
 * falls back to REDIS_URL so a single Redis instance needs no extra env var.
 */
export const queueConfig = registerAs('queue', () => {
  const env = queueEnvSchema.parse(process.env)
  return {
    url: env.QUEUE_REDIS_URL ?? env.REDIS_URL,
  }
})
