import { registerAs } from '@nestjs/config'
import { envObjectSchema } from '@onwealth/shared-kernel'

/**
 * HTTP env subset — validates ONLY the HTTP-transport slice.
 *
 * Derived from `envObjectSchema` via `.pick()` (single source of truth).
 * The factory parses this subset directly — never the full `validateEnv`.
 */
export const httpEnvSchema = envObjectSchema.pick({
  PORT: true,
  ALLOWED_ORIGINS: true,
  API_BASE_URL: true,
})

/**
 * Typed `http` namespace config factory.
 */
export const httpConfig = registerAs('http', () => {
  const env = httpEnvSchema.parse(process.env)
  return {
    port: env.PORT,
    allowedOrigins: env.ALLOWED_ORIGINS,
    apiBaseUrl: env.API_BASE_URL,
  }
})
