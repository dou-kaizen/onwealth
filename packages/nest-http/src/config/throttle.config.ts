import { registerAs } from '@nestjs/config'
import { envObjectSchema } from '@onwealth/shared-kernel'

/**
 * Throttle env subset — validates ONLY the rate-limit slice.
 *
 * Derived from `envObjectSchema` via `.pick()` (single source of truth).
 * The factory parses this subset directly — never the full `validateEnv`.
 */
export const throttleEnvSchema = envObjectSchema.pick({
  THROTTLE_TTL: true,
  THROTTLE_LIMIT: true,
})

/**
 * Typed `throttle` namespace config factory.
 */
export const throttleConfig = registerAs('throttle', () => {
  const env = throttleEnvSchema.parse(process.env)
  return {
    ttl: env.THROTTLE_TTL,
    limit: env.THROTTLE_LIMIT,
  }
})
