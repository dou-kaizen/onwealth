import { z } from 'zod'

/**
 * Base environment object schema — the flat, per-field validation rules.
 *
 * Exported separately from {@link envSchema} so per-namespace config
 * factories (`databaseConfig`, `redisConfig`, …) can derive subset schemas
 * via `.pick()`. Subsets never retype a field; they pick it — one source of
 * truth per field rule.
 *
 * Cross-field production hardening lives in {@link envSchema} below: a
 * `.superRefine()` does not return a `ZodObject`, so it cannot be `.pick()`'d.
 *
 * **All required vars have NO default** — startup fails with a clear error
 * if absent. Defaults are only set for tunables where a sane fallback won't
 * mask a misconfiguration.
 *
 * **Field rationale summary:**
 * - `PORT` — restricted to 1024–65535 because binding <1024 needs root on
 *   POSIX and is almost never what an app wants.
 * - `DATABASE_URL` / `REDIS_URL` — no default, prevents silent fail-open to
 *   localhost / unauthenticated dev DB.
 * - `QUEUE_REDIS_URL` — optional; falls back to `REDIS_URL`. Production TLS
 *   enforced via the {@link envSchema} cross-field refine.
 * - `JWT_SECRET` — `min(32)` blocks trivially brute-forceable secrets.
 * - `THROTTLE_TTL` — explicit ms unit (`min 1000`) guards against the
 *   foot-gun of treating it as seconds.
 * - `API_BASE_URL` — type URI prefix for RFC 9457 Problem Details; a wrong
 *   value emits URIs pointing at someone else's domain.
 */
export const envObjectSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  PORT: z
    .string()
    .default('3000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1024 && value < 65_536, {
      message: 'PORT must be between 1024 and 65535',
    }),

  DATABASE_URL: z.url('DATABASE_URL must be a valid URL'),

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

  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((origins) => !origins?.some((o) => o === '*' || o === 'null'), {
      message: 'ALLOWED_ORIGINS must not contain wildcard (*) or null entries',
    }),

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

  QUEUE_REDIS_URL: z
    .string()
    .refine((value) => /^rediss?:\/\/.+/.test(value), {
      message: 'QUEUE_REDIS_URL must start with redis:// or rediss://',
    })
    .optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  API_BASE_URL: z.url('API_BASE_URL must be a valid URL'),

  THROTTLE_TTL: z
    .string()
    .default('60000')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value >= 1000, {
      message: 'THROTTLE_TTL must be at least 1000ms (millisecond unit)',
    }),

  THROTTLE_LIMIT: z
    .string()
    .default('100')
    .transform((value) => Number.parseInt(value, 10))
    .refine((value) => value > 0, { message: 'THROTTLE_LIMIT must be greater than 0' }),
})

/**
 * Full environment variable schema — the HTTP app's fail-closed validation gate.
 *
 * Wraps {@link envObjectSchema} with cross-field production hardening.
 * Wired by {@link validateEnv} as `ConfigModule.forRoot({ validate })` in the
 * HTTP app only. Non-HTTP apps (e.g. a worker) compose their own gate from
 * the subset schemas they actually need — see the per-namespace config
 * factories in this folder.
 *
 * **Production-only refines:**
 * - `DB_POOL_MIN ≤ DB_POOL_MAX` (also enforced in `databaseConfig`).
 * - `THROTTLE_LIMIT ≤ 10000` — higher values effectively disable rate
 *   limiting.
 * - `REDIS_URL` / `QUEUE_REDIS_URL` MUST use `rediss://` (TLS).
 * - `DATABASE_URL` MUST include `sslmode=require` or `ssl=true` (or use
 *   `postgresql+ssl://` scheme) so hosted Postgres connections are encrypted.
 * - `JWT_SECRET` MUST NOT contain weak placeholder substrings AND MUST have
 *   charset diversity (upper + lower + digit) AND ≥16 distinct characters.
 * - `API_BASE_URL` MUST NOT contain `api.example.com` (would emit RFC 9457
 *   type URIs pointing at an external domain).
 */
export const envSchema = envObjectSchema.superRefine((data, ctx) => {
  const isProd = data.NODE_ENV === 'production'

  if (data.DB_POOL_MIN > data.DB_POOL_MAX) {
    ctx.addIssue({
      code: 'custom',
      path: ['DB_POOL_MIN'],
      message: `DB_POOL_MIN (${data.DB_POOL_MIN}) must be ≤ DB_POOL_MAX (${data.DB_POOL_MAX})`,
    })
  }

  if (isProd && data.THROTTLE_LIMIT > 10_000) {
    ctx.addIssue({
      code: 'custom',
      path: ['THROTTLE_LIMIT'],
      message: 'THROTTLE_LIMIT must be ≤ 10 000 in production',
    })
  }

  if (isProd && data.REDIS_URL?.startsWith('redis://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_URL'],
      message: 'REDIS_URL must use rediss:// (TLS) in production',
    })
  }

  if (isProd && data.QUEUE_REDIS_URL?.startsWith('redis://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['QUEUE_REDIS_URL'],
      message: 'QUEUE_REDIS_URL must use rediss:// (TLS) in production',
    })
  }

  if (isProd) {
    const dbUrl = data.DATABASE_URL
    const hasSSL =
      dbUrl.includes('sslmode=require') ||
      dbUrl.includes('ssl=true') ||
      dbUrl.startsWith('postgresql+ssl://')
    if (!hasSSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message:
          'DATABASE_URL must include sslmode=require or ssl=true (or use postgresql+ssl://) in production',
      })
    }
  }

  if (isProd) {
    const jwt = data.JWT_SECRET
    const jwtLower = jwt.toLowerCase()
    const weakPatterns = ['change-me', 'example', 'placeholder', 'your-secret']
    if (weakPatterns.some((p) => jwtLower.includes(p))) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must not contain placeholder substrings in production',
      })
    }
    const hasUpper = /[A-Z]/.test(jwt)
    const hasLower = /[a-z]/.test(jwt)
    const hasDigit = /[0-9]/.test(jwt)
    if (!(hasUpper && hasLower && hasDigit)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET must contain uppercase, lowercase, and numeric characters in production',
      })
    }
    const distinct = new Set(jwt).size
    if (distinct < 16) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: `JWT_SECRET must have at least 16 distinct characters in production (current: ${distinct})`,
      })
    }
  }

  if (isProd && data.API_BASE_URL?.includes('api.example.com')) {
    ctx.addIssue({
      code: 'custom',
      path: ['API_BASE_URL'],
      message: 'API_BASE_URL must not use api.example.com in production',
    })
  }
})

/**
 * Inferred shape of a fully-parsed env object — every field present, every
 * numeric/transformed field already coerced to its runtime type.
 */
export type Env = z.infer<typeof envSchema>

/**
 * Validate `process.env` against {@link envSchema} and return the parsed
 * shape, or throw a wrapped {@link Error} listing every offending field.
 *
 * Wired into `ConfigModule.forRoot({ validate: validateEnv })` so the HTTP
 * app fails closed at boot if any required var is missing/invalid.
 *
 * @param config Typically `process.env` (NestJS passes it for you).
 * @returns Parsed, type-safe env.
 *
 * @throws {Error} on any Zod failure. The `cause` is the original
 *         {@link z.ZodError}; the message lists `path: reason` per issue,
 *         one per line, so operator output is immediately actionable.
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
