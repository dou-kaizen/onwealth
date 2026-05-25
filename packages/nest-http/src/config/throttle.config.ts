import { registerAs } from '@nestjs/config'
import { envObjectSchema } from '@onwealth/shared-kernel'

/**
 * Throttle env subset — validates ONLY the rate-limit slice.
 *
 * Derived from `envObjectSchema` via `.pick()` so field rules stay
 * identical to the full gate (single source of truth). The factory parses
 * this subset directly — never the full `validateEnv` — so a non-HTTP app
 * loading only `throttleConfig` does not transitively depend on unrelated
 * vars.
 */
export const throttleEnvSchema = envObjectSchema.pick({
  THROTTLE_TTL: true,
  THROTTLE_LIMIT: true,
})

/**
 * Typed `throttle` namespace config factory.
 *
 * @returns Object exposing `{ ttl, limit }` via `ConfigService.get('throttle')`.
 *          `ttl` is in milliseconds (the unit `THROTTLE_TTL` is defined in);
 *          fed directly to `@nestjs/throttler`'s `ThrottlerModule.forRoot`.
 */
export const throttleConfig = registerAs('throttle', () => {
  const env = throttleEnvSchema.parse(process.env)
  return {
    ttl: env.THROTTLE_TTL,
    limit: env.THROTTLE_LIMIT,
  }
})
