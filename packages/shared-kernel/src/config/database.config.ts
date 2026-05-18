import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

/**
 * Database env subset — validates ONLY the database slice.
 *
 * Derived from {@link envObjectSchema} via `.pick()` so the field rules stay
 * identical to the full gate (single source of truth). The factory parses this
 * subset directly — it never calls the full `validateEnv`, so a non-HTTP app
 * loading only `databaseConfig` does not depend on `JWT_SECRET`/`API_BASE_URL`.
 */
export const databaseEnvSchema = envObjectSchema.pick({
  DATABASE_URL: true,
  DB_POOL_MAX: true,
  DB_POOL_MIN: true,
  DB_POOL_IDLE_TIMEOUT: true,
  DB_POOL_CONNECTION_TIMEOUT: true,
})

/**
 * Typed `database` namespace config factory.
 */
export const databaseConfig = registerAs('database', () => {
  const env = databaseEnvSchema.parse(process.env)
  return {
    url: env.DATABASE_URL,
    pool: {
      max: env.DB_POOL_MAX,
      min: env.DB_POOL_MIN,
      idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT,
    },
  }
})
