/**
 * Minimal CorsOptions type (mirrors @nestjs/common CorsOptions without deep-path import)
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
 * CORS cross-origin configuration
 *
 * Controls which origins are allowed to access the API
 */
export function createCorsConfig(allowedOrigins?: string[]): CorsOptions {
  if (!allowedOrigins?.length) {
    // Fail-closed: no credentialed CORS when origins unset.
    // Set ALLOWED_ORIGINS=http://localhost:3000 in .env for dev.
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
