import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

/**
 * Redis env subset — validates ONLY the redis slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` (single source of truth).
 * The factory parses this subset directly — never the full `validateEnv`.
 */
export const redisEnvSchema = envObjectSchema.pick({
  REDIS_URL: true,
  REDIS_TTL: true,
})

/**
 * Typed `redis` namespace config factory.
 */
export const redisConfig = registerAs('redis', () => {
  const env = redisEnvSchema.parse(process.env)
  return {
    url: env.REDIS_URL,
    ttl: env.REDIS_TTL,
  }
})
