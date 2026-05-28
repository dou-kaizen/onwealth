# Security and Middleware Documentation

This documentation explains the security middleware stack in `@boilerplate/nest-http`: Helmet
(globally disabled CSP with a scoped re-enable for doc routes), CORS allowlist, `@nestjs/throttler`
rate limiting, CLS request context, and graceful shutdown wiring.

## Related Documents

- [Environment Variables](./environment.md) — `ALLOWED_ORIGINS`, `THROTTLE_TTL`, `THROTTLE_LIMIT`, `JWT_SECRET`
- [Configuration Documentation](./configuration.md) — namespaced config factories
- [Handling Error Documentation](./handling-error.md) — `ThrottlerExceptionFilter` and rate-limit headers
- [Response Documentation](./response.md) — full pipeline order including middleware position

## Table of Contents

- [Overview](#overview)
- [Related Documents](#related-documents)
- [Configuration](#configuration)
- [Structure](#structure)
- [Bootstrap Sequence](#bootstrap-sequence)
- [Helmet and Scoped CSP](#helmet-and-scoped-csp)
- [CORS Allowlist](#cors-allowlist)
- [Rate Limiting](#rate-limiting)
- [CLS Request Context](#cls-request-context)
- [Graceful Shutdown](#graceful-shutdown)
- [Usage](#usage)
  - [Adding an Allowed Origin](#adding-an-allowed-origin)
  - [Adjusting Throttle Limits](#adjusting-throttle-limits)
- [Creating New Middleware](#creating-new-middleware)
- [Behavior Reference](#behavior-reference)
- [References](#references)

## Overview

The security stack is applied in `configureHttpApp()` before any route handler runs. The setup
order is deterministic and must not be changed without re-validating the test gate:

1. Global Helmet (CSP and COEP disabled for JSON API routes)
2. Scoped Helmet with CSP for `/swagger` and `/docs` only
3. `trust proxy = 1` for real client IP behind a reverse proxy
4. JSON body parser with explicit size limit (`100kb`)
5. CORS — env-driven allowlist in production, fixed localhost in test mode
6. Global `/api` prefix with health/well-known exclusions
7. Exception filters, interceptors, validation pipe, Swagger setup
8. `enableShutdownHooks()` for OS signal handling

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L48–L181`

## Configuration

| Variable | Default | Constraint | Description |
|---|---|---|---|
| `ALLOWED_ORIGINS` | — (required) | No `*` or `null` entries | Comma-separated origin allowlist for CORS |
| `THROTTLE_TTL` | `60000` | `>= 1000 ms` | Rate-limit window in milliseconds |
| `THROTTLE_LIMIT` | `100` | `> 0`; `<= 10000` in prod | Max requests per window per client IP |
| `PORT` | `3000` | `1024–65535` | HTTP listening port |
| `API_BASE_URL` | — (required) | Valid URL; not `api.example.com` in prod | External base URL; feeds CORS trust model |
| `JWT_SECRET` | — (required) | `>= 32 chars`; charset diversity in prod | JWT signing secret |

`ALLOWED_ORIGINS` is parsed at startup by `envObjectSchema`:

```typescript
ALLOWED_ORIGINS: z.string().optional()
  .transform((value) =>
    value?.split(',').map((s) => s.trim()).filter(Boolean),
  )
  .refine((origins) => !origins?.some((o) => o === '*' || o === 'null'), {
    message: 'ALLOWED_ORIGINS must not contain wildcard (*) or null entries',
  })
```

Source: `packages/shared-kernel/src/config/env.schema.ts:L76–L87`

The `*` / `null` rejection applies in all environments, not just production. An empty or absent
`ALLOWED_ORIGINS` causes `createCorsConfig()` to return `{ origin: false, credentials: false }`
— no CORS at all rather than an implicit wildcard.

Source: `packages/nest-http/src/config/security.config.ts:L41–L44`

## Structure

| File | Responsibility |
|---|---|
| `packages/nest-http/src/bootstrap/configure-http-app.ts` | Single entry point; orchestrates all middleware and filter registration |
| `packages/nest-http/src/config/security.config.ts` | `createCorsConfig()` — CORS options builder |
| `packages/nest-http/src/config/throttle.config.ts` | `throttleConfig` — `{ ttl, limit }` namespace |
| `packages/nest-http/src/config/http.config.ts` | `httpConfig` — `{ port, allowedOrigins, apiBaseUrl }` namespace |
| `packages/nest-http/src/config/cls.config.ts` | `createClsConfig()` — request-scoped CLS context setup |
| `packages/nest-http/src/filters/throttler-exception.filter.ts` | `ThrottlerExceptionFilter` — 429 response with rate-limit headers |
| `apps/api/src/main.ts` | Bootstrap entry; `unhandledRejection` / `uncaughtException` shutdown handlers |

## Bootstrap Sequence

`configureHttpApp` is called with an already-created `NestExpressApplication`. The caller
(`apps/api/src/main.ts`) owns `app.listen()` and logger wiring. The function returns the same
app instance for chaining.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L65–L184`

In test mode (`testMode: true`), CORS is fixed to `['http://localhost:3000']` and Swagger is
skipped. This ensures the test app behaves identically to production for security concerns while
avoiding Swagger instrumentation overhead.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L119–L122`, `L177–L179`

## Helmet and Scoped CSP

Helmet is applied in two passes.

**Pass 1 — global (all routes):**

```typescript
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
```

CSP is disabled globally because this application serves `application/json` responses. Browsers
ignore CSP on JSON responses, so a global CSP header would add noise without security benefit.
COEP is also disabled for the same reason.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L75`

**Pass 2 — scoped CSP for `/swagger` and `/docs`:**

```typescript
app.use(
  ['/swagger', '/swagger/{*path}', '/docs', '/docs/{*path}'],
  helmet({ contentSecurityPolicy: { useDefaults: false, directives: { ... } } }),
)
```

SwaggerUI and Scalar both render HTML with inline scripts and styles for their UI shell. A
scoped CSP is applied to these routes only, with conservative directives:

| Directive | Value | Rationale |
|---|---|---|
| `default-src` | `'self'` | Deny-all baseline |
| `script-src` | `'self' 'unsafe-inline' cdn.jsdelivr.net` | Inline scripts required by SwaggerUI/Scalar; CDN for assets |
| `style-src` | `'self' 'unsafe-inline' cdn.jsdelivr.net` | Inline styles required by UI shell |
| `img-src` | `'self' data: cdn.jsdelivr.net` | Inline data URIs for icons |
| `font-src` | `'self' data: cdn.jsdelivr.net` | Web fonts |
| `connect-src` | `'self'` | XHR/fetch to same origin only |
| `frame-ancestors` | `'none'` | Blocks clickjacking via iframe embedding |
| `object-src` | `'none'` | Blocks Flash and plugin injection |
| `base-uri` | `'self'` | Prevents base-tag hijacking |
| `form-action` | `'self'` | Prevents open-redirect via form submission |

`'unsafe-inline'` on `script-src` is an accepted residual risk. SwaggerUI's
`persistAuthorization: true` stores tokens in `localStorage`, making them reachable if a
future XSS occurs. Re-evaluate when either UI adds first-class nonce support.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L77–L111`

## CORS Allowlist

`createCorsConfig(allowedOrigins?)` builds the CORS options object.

**Allowed request headers** (clients may send):

`Content-Type`, `Authorization`, `Accept`, `X-Request-Id`, `X-Correlation-Id`,
`Traceparent`, `Tracestate`

**Exposed response headers** (browser JS may read):

`X-Request-Id`, `X-Correlation-Id`, `Trace-Id`, `Link`, `Location`, `ETag`,
`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

`credentials: true` and `maxAge: 3600` (preflight cached for 1 hour).

Source: `packages/nest-http/src/config/security.config.ts:L41–L72`

`trust proxy = 1` is set so Express trusts one hop of `X-Forwarded-For`, allowing
`ThrottlerGuard` to rate-limit by real client IP rather than the load-balancer address.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L113`

## Rate Limiting

`@nestjs/throttler` is configured via `throttleConfig`. The global `APP_GUARD` registered in
`AppModule` applies to every route. Routes decorated with `@SkipThrottle()` are exempt.

`THROTTLE_TTL` must be `>= 1000 ms`. The Zod field refine rejects lower values at bootstrap:

```
THROTTLE_TTL must be at least 1000ms (millisecond unit)
```

Source: `packages/shared-kernel/src/config/env.schema.ts:L112–L118`

In production, `THROTTLE_LIMIT > 10000` is also rejected (would effectively disable limiting):

Source: `packages/shared-kernel/src/config/env.schema.ts:L159–L163`

When a client exceeds the limit, `ThrottlerExceptionFilter` intercepts `ThrottlerException`
and returns 429 with:

- `Retry-After: <ttl_seconds>` — full window TTL in seconds (RFC 6585 §4)
- `X-RateLimit-Limit: <limit>`
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: <unix_timestamp>`

The RFC 9457 body `type` URI is `${API_BASE_URL}/errors/rate-limit-exceeded`.

Source: `packages/nest-http/src/filters/throttler-exception.filter.ts:L46–L79`

Body size is limited to `100kb` via `express.json({ limit: '100kb' })` to guard against
payload amplification attacks.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L115`

## CLS Request Context

`createClsConfig()` mounts the `nestjs-cls` middleware globally. On every request it populates:

| CLS key | Source | Sanitized |
|---|---|---|
| `id` (request ID) | `X-Request-Id` header or `randomUUID()` | Allowlist regex `[\w-]{1,128}` |
| `correlationId` | `X-Correlation-Id` header or `randomUUID()` | Allowlist regex `[\w-]{1,128}` |
| `userAgent` | `User-Agent` header | `sanitizeHeaderValue()` (strips CR/LF/TAB/NUL/ANSI) |
| `ip` | `request.ip` | Raw (trusted after `trust proxy`) |
| `traceId` | Parsed from `Traceparent` (W3C format) | Validated by `parseTraceparent()` |
| `parentId` | Parsed from `Traceparent` | Validated by `parseTraceparent()` |
| `tracestate` | `Tracestate` header, truncated to 512 bytes | `sanitizeHeaderValue()` |

`userAgent` and `tracestate` are attacker-controlled headers. Sanitization blocks log injection
via CR/LF/NUL/ANSI escape sequences that would corrupt log shippers downstream.

Source: `packages/nest-http/src/config/cls.config.ts:L56–L90`

CLS values are consumed by `ProblemDetailsFilter` (tracing IDs in error envelopes) and by the
interceptors (`CorrelationIdInterceptor`, `TraceContextInterceptor`) that echo the IDs back as
response headers.

## Graceful Shutdown

`apps/api/src/main.ts` registers two process-level handlers before `bootstrap()` runs:

```typescript
process.on('unhandledRejection', (reason) => {
  void shutdown(1, 'unhandledRejection', reason)
})
process.on('uncaughtException', (err) => {
  void shutdown(1, 'uncaughtException', err)
})
```

Source: `apps/api/src/main.ts:L99–L103`

The `shutdown()` function executes in order:

1. Resolve a logger — uses the app's pino instance if the app booted, falls back to `console`
   for pre-bootstrap failures. Routes fatal output through the same transports as the rest of
   the app.
2. `await app.close()` — runs Nest's `onModuleDestroy` lifecycle: drains the HTTP server,
   closes the Postgres pool, shuts down BullMQ workers.
3. `setTimeout(() => process.exit(code), 5000).unref()` — hard-stop fallback after 5 seconds
   so a hanging `close()` cannot wedge the process indefinitely. `.unref()` keeps the timer
   from holding the event loop open in the happy path.

Source: `apps/api/src/main.ts:L14`, `L78–L97`

OS signals (SIGTERM / SIGINT) follow the same drain path via `app.enableShutdownHooks()`,
which is called as the last step of `configureHttpApp`.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L181`

## Usage

### Adding an Allowed Origin

Set `ALLOWED_ORIGINS` as a comma-separated list in the environment:

```
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

Wildcards (`*`) and `null` are rejected at all times. An absent value disables CORS entirely
(fail-closed). In test mode, the origin is hard-coded to `http://localhost:3000` regardless of
the env var.

### Adjusting Throttle Limits

Set `THROTTLE_TTL` (milliseconds) and `THROTTLE_LIMIT` in the environment:

```
THROTTLE_TTL=60000    # 60 second window
THROTTLE_LIMIT=200    # 200 requests per window
```

Minimum `THROTTLE_TTL` is 1000 ms — values below this are rejected at bootstrap. Production
environments additionally reject `THROTTLE_LIMIT > 10000`.

To exempt a route from throttling, apply `@SkipThrottle()` from `@nestjs/throttler` on the
controller method or class.

## Creating New Middleware

For cross-cutting middleware that must run on every request (tracing, request logging, etc.),
add it to `configureHttpApp` before the filter/interceptor block. Use `app.use(middleware)`
for Express-style middleware or register it in `ClsModule` middleware setup if it needs access
to the CLS store.

For route-scoped middleware, register it in `apps/api/src/app.module.ts` via the
`configure(consumer: MiddlewareConsumer)` method:

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(YourMiddleware)
      .forRoutes({ path: '/specific-path', method: RequestMethod.GET })
  }
}
```

If the middleware needs to write a response header that clients should read cross-origin, add
the header name to `exposedHeaders` in `createCorsConfig()`.

Source: `packages/nest-http/src/config/security.config.ts:L57–L69`

## Behavior Reference

| Scenario | Outcome | Source |
|---|---|---|
| `ALLOWED_ORIGINS` contains `*` | Bootstrap fails with Zod error | `env.schema.ts:L85` |
| `ALLOWED_ORIGINS` absent | CORS disabled (`origin: false`) | `security.config.ts:L43` |
| Request from non-allowed origin | CORS preflight rejected | `security.config.ts:L44–L45` |
| `THROTTLE_TTL` < 1000 ms | Bootstrap fails with Zod error | `env.schema.ts:L115` |
| Rate limit exceeded | 429 + `Retry-After` + `X-RateLimit-*` headers | `throttler-exception.filter.ts:L46` |
| `THROTTLE_LIMIT` > 10000 in prod | Bootstrap fails with Zod error | `env.schema.ts:L159` |
| Request body > 100kb | 413 Payload Too Large (Express default) | `configure-http-app.ts:L115` |
| `X-Request-Id` header present | Reused as CLS request ID if it matches `[\w-]{1,128}` | `cls.config.ts:L43` |
| `X-Request-Id` fails allowlist | New `randomUUID()` generated; client value discarded | `cls.config.ts:L22` |
| `User-Agent` contains ANSI escapes | Stripped by `sanitizeHeaderValue()` before CLS store | `cls.config.ts:L66` |
| GET `/swagger` | Scoped CSP headers applied | `configure-http-app.ts:L92` |
| GET `/api/users` (JSON route) | No CSP header (global CSP disabled) | `configure-http-app.ts:L75` |
| SIGTERM received | `app.close()` drain → 5s hard-stop fallback | `main.ts:L78–L97` |
| `unhandledRejection` | `shutdown(1, 'unhandledRejection', reason)` | `main.ts:L99` |
| `uncaughtException` | `shutdown(1, 'uncaughtException', err)` | `main.ts:L102` |
| `JWT_SECRET` < 32 chars | Bootstrap fails with Zod error | `env.schema.ts:L108` |
| `JWT_SECRET` weak in prod | Bootstrap fails (charset diversity + distinct chars) | `env.schema.ts:L199–L229` |
| `REDIS_URL` uses `redis://` in prod | Bootstrap fails — must be `rediss://` (TLS) | `env.schema.ts:L167` |
| `DATABASE_URL` missing SSL in prod | Bootstrap fails — must include `sslmode=require` | `env.schema.ts:L183–L196` |

<!-- REFERENCES -->

[ref-helmet]: https://helmetjs.github.io
[ref-owasp]: https://owasp.org/www-project-top-ten/
[ref-rfc-6585]: https://datatracker.ietf.org/doc/html/rfc6585
[ref-rfc-9110]: https://datatracker.ietf.org/doc/html/rfc9110
[ref-throttler]: https://github.com/nestjs/throttler
[ref-cors-spec]: https://fetch.spec.whatwg.org/#cors-protocol
