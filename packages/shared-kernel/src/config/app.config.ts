import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

/**
 * App env subset — validates ONLY the application-runtime slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` (single source of truth).
 * Currently `NODE_ENV` only — `LOG_LEVEL` is not part of `envObjectSchema`;
 * the logger derives its level from `NODE_ENV`.
 */
export const appEnvSchema = envObjectSchema.pick({
  NODE_ENV: true,
})

/**
 * Typed `app` namespace config factory.
 */
export const appConfig = registerAs('app', () => {
  const env = appEnvSchema.parse(process.env)
  return {
    nodeEnv: env.NODE_ENV,
  }
})
