/**
 * Minimal CorsOptions type mirroring `@nestjs/common`'s `CorsOptions`
 * without the deep import path.
 *
 * Kept local so this module does not drag in `@nestjs/common`'s internal
 * subpath; only the shape consumed by `app.enableCors()` is exposed.
 */
interface CorsOptions {
  origin?:
    | boolean
    | string
    | RegExp
    | string[]
    | RegExp[]
    | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void)
  methods?: string | string[]
  allowedHeaders?: string | string[]
  exposedHeaders?: string | string[]
  credentials?: boolean
  maxAge?: number
  preflightContinue?: boolean
  optionsSuccessStatus?: number
}

/**
 * Build a CORS configuration consumed by `app.enableCors()`.
 *
 * **Fail-closed default:** when `allowedOrigins` is empty/undefined,
 * returns `{ origin: false, credentials: false }` — no credentialed CORS,
 * no implicit `*` echo. Set `ALLOWED_ORIGINS=http://localhost:3000` in
 * `.env` for dev.
 *
 * **Allowlisted request headers** are the ones the client legitimately
 * sends: content negotiation + tracing IDs. **Exposed response headers**
 * extend the set the browser can read — includes pagination (`Link`),
 * created-resource (`Location`), caching (`ETag`), and rate-limit metadata.
 *
 * `maxAge: 3600` caches preflight responses for an hour to cut OPTIONS
 * traffic on chatty clients.
 */
export function createCorsConfig(allowedOrigins?: string[]): CorsOptions {
  if (!allowedOrigins?.length) {
    return { origin: false, credentials: false }
  }
  return {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Request-Id',
      'X-Correlation-Id',
      'Traceparent',
      'Tracestate',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Correlation-Id',
      'Trace-Id',
      'Link',
      'Location',
      'ETag',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    credentials: true,
    maxAge: 3600,
  }
}
