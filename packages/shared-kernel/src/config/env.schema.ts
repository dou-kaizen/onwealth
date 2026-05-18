import { z } from 'zod'

/**
 * Base environment object schema — the flat, per-field validation rules.
 *
 * Exported separately from {@link envSchema} so per-namespace config factories
 * (`databaseConfig`, `redisConfig`, …) can derive subset schemas via `.pick()`.
 * This keeps a single source of truth for each field's rule: subsets never
 * retype a field, they pick it. The cross-field production hardening checks
 * live in {@link envSchema} below (a `.superRefine()` is not a `ZodObject`, so
 * it has no `.pick()`).
 *
 * All required vars have NO default — startup fails with a clear error if absent.
 */
export const envObjectSchema = z.object({
  // Application environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Application port — restricted to unprivileged range (1024–65535).
  // Binding to ports <1024 needs root on POSIX and is almost never what the app wants.
  PORT: z
    .string()
    .default('3000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1024 && value < 65_536, {
      message: 'PORT must be between 1024 and 65535',
    }),

  // Database connection string — REQUIRED, no default to prevent silent wrong-DB connections
  DATABASE_URL: z.url('DATABASE_URL must be a valid URL'),

  // Database connection pool configuration
  DB_POOL_MAX: z
    .string()
    .default('20')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0 && value <= 100, {
      message: 'DB_POOL_MAX must be between 1 and 100',
    }),

  DB_POOL_MIN: z
    .string()
    .default('5')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 0 && value <= 50, {
      message: 'DB_POOL_MIN must be between 0 and 50',
    }),

  DB_POOL_IDLE_TIMEOUT: z
    .string()
    .default('30000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1000, {
      message: 'DB_POOL_IDLE_TIMEOUT must be at least 1000ms',
    }),

  DB_POOL_CONNECTION_TIMEOUT: z
    .string()
    .default('10000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1000, {
      message: 'DB_POOL_CONNECTION_TIMEOUT must be at least 1000ms',
    }),

  // CORS configuration
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Redis connection string — REQUIRED, no default to prevent fail-open to unauthenticated localhost
  REDIS_URL: z.string().refine((value) => /^rediss?:\/\/.+/.test(value), {
    message: 'REDIS_URL must start with redis:// or rediss://',
  }),

  REDIS_TTL: z
    .string()
    .default('3600')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, {
      message: 'REDIS_TTL must be greater than 0',
    }),

  // JWT secret — REQUIRED, min 32 chars to prevent trivially brute-forceable secrets
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // API base URL — REQUIRED; used as the type URI prefix for RFC 9457 Problem Details.
  // No default: a wrong URL would produce type URIs pointing to an external domain.
  API_BASE_URL: z.url('API_BASE_URL must be a valid URL'),

  // Rate limiting — default 100 req/window; prod superRefine rejects >10 000
  THROTTLE_TTL: z
    .string()
    .default('60000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, { message: 'THROTTLE_TTL must be greater than 0' }),

  THROTTLE_LIMIT: z
    .string()
    .default('100')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, { message: 'THROTTLE_LIMIT must be greater than 0' }),
})

/**
 * Full environment variable schema — the HTTP app's fail-closed validation gate.
 *
 * Wraps {@link envObjectSchema} with cross-field production hardening checks.
 * Used by {@link validateEnv} as `ConfigModule.forRoot({ validate })` in the
 * HTTP app only. Non-HTTP apps (e.g. a worker) compose their own gate from the
 * subset schemas they need — see the per-namespace config factories.
 */
export const envSchema = envObjectSchema.superRefine((data, ctx) => {
  const isProd = data.NODE_ENV === 'production'

  // Reject THROTTLE_LIMIT >10 000 in prod — values this high effectively disable rate limiting
  if (isProd && data.THROTTLE_LIMIT > 10_000) {
    ctx.addIssue({
      code: 'custom',
      path: ['THROTTLE_LIMIT'],
      message: 'THROTTLE_LIMIT must be ≤ 10 000 in production',
    })
  }

  // Reject plain redis:// in prod — Redis traffic must be TLS-encrypted
  if (isProd && data.REDIS_URL?.startsWith('redis://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_URL'],
      message: 'REDIS_URL must use rediss:// (TLS) in production',
    })
  }

  // Reject placeholder JWT_SECRET to prevent accidental use of the .env.example value
  if (isProd && data.JWT_SECRET === 'your-secret-key-change-me-in-production-min-32-chars') {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must not use the example placeholder value in production',
    })
  }

  // Reject api.example.com in prod — would produce RFC 9457 type URIs pointing to an external domain
  if (isProd && data.API_BASE_URL?.includes('api.example.com')) {
    ctx.addIssue({
      code: 'custom',
      path: ['API_BASE_URL'],
      message: 'API_BASE_URL must not use api.example.com in production',
    })
  }
})

/**
 * Environment variable type
 */
export type Env = z.infer<typeof envSchema>

/**
 * Validate environment variables
 *
 * @throws {z.ZodError} if environment variable validation fails
 */
export function validateEnv(config: Record<string, unknown>): Env {
  try {
    return envSchema.parse(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues
        .map((error_: z.core.$ZodIssue) => `${error_.path.join('.')}: ${error_.message}`)
        .join('\n')

      throw new Error(
        `Environment variable validation failed:\n${errorMessages}\n\nPlease check your .env file or environment variable configuration`,
        { cause: error },
      )
    }
    throw error
  }
}
