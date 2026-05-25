import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

/**
 * App env subset — validates ONLY the application-runtime slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` so the field rules stay
 * identical to the full gate (single source of truth). Currently `NODE_ENV`
 * only; `LOG_LEVEL` is not modelled because the logger derives its level
 * from `NODE_ENV`.
 */
export const appEnvSchema = envObjectSchema.pick({
  NODE_ENV: true,
})

/**
 * Typed `app` namespace config factory.
 *
 * Parses {@link appEnvSchema} directly so a non-HTTP entrypoint loading only
 * `appConfig` does not transitively require unrelated vars (DB, JWT, …).
 *
 * @returns Object exposing `{ nodeEnv }` via `ConfigService.get('app')`.
 */
export const appConfig = registerAs('app', () => {
  const env = appEnvSchema.parse(process.env)
  return {
    nodeEnv: env.NODE_ENV,
  }
})
