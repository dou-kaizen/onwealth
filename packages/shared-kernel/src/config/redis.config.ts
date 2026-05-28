import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

/**
 * Redis env subset — validates ONLY the Redis slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` so field rules stay
 * identical to the full gate. The factory parses this subset directly —
 * never the full `validateEnv` — so a non-HTTP app loading only `redisConfig`
 * does not transitively depend on unrelated vars.
 */
export const redisEnvSchema = envObjectSchema.pick({
  REDIS_URL: true,
  REDIS_TTL: true,
})

/**
 * Typed `redis` namespace config factory.
 *
 * @returns Object exposing `{ url, ttl }` via `ConfigService.get('redis')`.
 *          `ttl` is in seconds; consumers multiply by 1000 at the boundary
 *          when feeding millisecond-based libraries.
 */
export const redisConfig = registerAs('redis', () => {
  const env = redisEnvSchema.parse(process.env)
  return {
    url: env.REDIS_URL,
    ttl: env.REDIS_TTL,
  }
})
