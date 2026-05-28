import { envObjectSchema } from '@boilerplate/shared-kernel'
import { registerAs } from '@nestjs/config'

/**
 * HTTP env subset — validates ONLY the HTTP-transport slice.
 *
 * Derived from `envObjectSchema` via `.pick()` so field rules stay
 * identical to the full gate (single source of truth). The factory parses
 * this subset directly — never the full `validateEnv` — so a non-HTTP app
 * loading only `httpConfig` does not transitively depend on unrelated vars.
 */
export const httpEnvSchema = envObjectSchema.pick({
  PORT: true,
  ALLOWED_ORIGINS: true,
  API_BASE_URL: true,
})

/**
 * Typed `http` namespace config factory.
 *
 * @returns Object exposing `{ port, allowedOrigins, apiBaseUrl }` via
 *          `ConfigService.get('http')`. `apiBaseUrl` feeds the type URI
 *          prefix in RFC 9457 Problem Details responses.
 */
export const httpConfig = registerAs('http', () => {
  const env = httpEnvSchema.parse(process.env)
  return {
    port: env.PORT,
    allowedOrigins: env.ALLOWED_ORIGINS,
    apiBaseUrl: env.API_BASE_URL,
  }
})
