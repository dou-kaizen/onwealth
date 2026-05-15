import { z } from 'zod'

/**
 * Sentinel placeholder values — IF a deployment ships with these literal
 * values AND `NODE_ENV === 'production'`, boot fails loud. Catches the
 * "forgot to set the secret" footgun before the API ever serves traffic.
 *
 * Keys MUST match envSchema field names exactly; the production guard
 * iterates this map.
 */
const PROD_FORBIDDEN_DEFAULTS = {
  JWT_SECRET: 'your-secret-key-change-me-in-production-min-32-chars',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/onwealth',
  API_BASE_URL: 'https://api.example.com',
  REDIS_URL: 'redis://localhost:6379',
} as const

/**
 * Foundation env schema.
 *
 * Transport-agnostic only — feature-tier keys (OAuth client IDs, bot
 * tokens, etc.) MUST stay out of the foundation. Add them in feature
 * modules' own env extensions when they arrive.
 *
 * Required-in-production vars (`JWT_SECRET`, `DATABASE_URL`,
 * `API_BASE_URL`) intentionally have NO `.default()`. Supply them via
 * `.env.example` for local dev. Production guard below rejects placeholder
 * values from leaking to prod.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    PORT: z
      .string()
      .default('3000')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value > 0 && value < 65_536, {
        message: 'PORT must be between 1 and 65535',
      }),

    DATABASE_URL: z.url(),

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

    JWT_SECRET: z.string().min(32, {
      message: 'JWT_SECRET must be at least 32 characters long (use a randomly generated key)',
    }),

    JWT_EXPIRES_IN: z
      .string()
      .default('15m')
      .refine((value) => /^\d+[smhd]$/.test(value), {
        message: 'JWT_EXPIRES_IN format is invalid (e.g. 60s, 15m, 2h, 7d)',
      }),

    JWT_REFRESH_EXPIRES_IN: z
      .string()
      .default('7d')
      .refine((value) => /^\d+[smhd]$/.test(value), {
        message: 'JWT_REFRESH_EXPIRES_IN format is invalid (e.g. 60s, 15m, 2h, 7d)',
      }),

    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    REDIS_URL: z
      .string()
      .refine((value) => /^rediss?:\/\/.+/.test(value), {
        message: 'REDIS_URL must start with redis:// or rediss://',
      })
      .default('redis://localhost:6379'),

    REDIS_TTL: z
      .string()
      .default('3600')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value > 0, {
        message: 'REDIS_TTL must be greater than 0',
      }),

    API_BASE_URL: z.url(),

    THROTTLE_TTL: z
      .string()
      .default('60000')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value > 0, { message: 'THROTTLE_TTL must be greater than 0' }),

    THROTTLE_LIMIT: z
      .string()
      .default('300')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value > 0, { message: 'THROTTLE_LIMIT must be greater than 0' }),

    REQUEST_TIMEOUT_MS: z
      .string()
      .default('30000')
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => value >= 1000, {
        message: 'REQUEST_TIMEOUT_MS must be at least 1000ms',
      }),

    /**
     * Toggle Swagger UI + Scalar + /openapi.yaml route exposure.
     *
     * Default behavior (resolved in main.ts via `?? (NODE_ENV !== 'production')`):
     * - production → false (closes attack surface)
     * - non-production → true (dev/staging convenience)
     *
     * CI override: set explicit `ENABLE_SWAGGER=true` for codegen pipelines
     * even on production-like envs.
     *
     * Strict whitelist: only literal `'true'` or `'false'` accepted.
     * Any other value (`'1'`, `'yes'`, `'TRUE'`, etc.) → boot fails loud.
     */
    ENABLE_SWAGGER: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
  })
  .check((ctx) => {
    if (ctx.value.NODE_ENV === 'production') {
      for (const [key, forbidden] of Object.entries(PROD_FORBIDDEN_DEFAULTS)) {
        const value = ctx.value[key as keyof typeof PROD_FORBIDDEN_DEFAULTS]
        if (value === forbidden) {
          ctx.issues.push({
            code: 'custom',
            path: [key],
            message: `${key} must not use the placeholder default value in production`,
            input: value,
          })
        }
      }
    }
    if (ctx.value.DB_POOL_MIN > ctx.value.DB_POOL_MAX) {
      ctx.issues.push({
        code: 'custom',
        path: ['DB_POOL_MIN'],
        message: `DB_POOL_MIN (${ctx.value.DB_POOL_MIN}) must be <= DB_POOL_MAX (${ctx.value.DB_POOL_MAX})`,
        input: ctx.value.DB_POOL_MIN,
      })
    }
  })

export type Env = z.infer<typeof envSchema>

/**
 * Parse and validate process env.
 *
 * @throws Error wrapping ZodError when validation fails (with all issues joined).
 */
export function validateEnv(config: Record<string, unknown>): Env {
  try {
    return envSchema.parse(config)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')

      throw new Error(
        `Environment variable validation failed:\n${errorMessages}\n\nPlease check your .env file or environment variable configuration`,
        { cause: error },
      )
    }
    throw error
  }
}
