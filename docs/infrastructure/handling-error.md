# Handling Error Documentation

This documentation explains the centralized exception handling system in `@boilerplate/nest-http`.
All runtime errors — HTTP exceptions, database errors, and uncaught throwables — are normalized
into [RFC 9457][ref-rfc-9457] Problem Details responses before leaving the filter chain.

## Related Documents

- [Response Documentation](./response.md) — envelope interceptor and pipeline order
- [Request Validation Documentation](./request-validation.md) — how validation failures become Problem Details
- [Security and Middleware Documentation](./security-and-middleware.md) — filter registration order
- [Environment Variables](./environment.md) — `API_BASE_URL` used as `type` URI prefix

## Table of Contents

- [Overview](#overview)
- [Related Documents](#related-documents)
- [Exception Filters](#exception-filters)
  - [AllExceptionsFilter](#allexceptionsfilter)
  - [ProblemDetailsFilter](#problemdetailsfilter)
  - [ThrottlerExceptionFilter](#throttlerexceptionfilter)
- [Configuration](#configuration)
- [RFC 9457 Envelope Shape](#rfc-9457-envelope-shape)
- [Database Error Mapping](#database-error-mapping)
- [CLS Context in Error Logs](#cls-context-in-error-logs)
- [Usage](#usage)
  - [Throwing HTTP Exceptions](#throwing-http-exceptions)
  - [Throwing Business Errors with Codes](#throwing-business-errors-with-codes)
- [Creating a New Error Code](#creating-a-new-error-code)
- [Behavior Reference](#behavior-reference)
- [References](#references)

## Overview

The error handling stack has three exception filters registered globally. NestJS reverses the
registration order internally (see `RouterExceptionFilters.create`), so the effective match
priority from first to last is:

1. `ThrottlerExceptionFilter` — matches `ThrottlerException` → 429 + rate-limit headers
2. `ProblemDetailsFilter` — matches every `HttpException` → RFC 9457 body
3. `AllExceptionsFilter` — catch-all fallback; dispatches `HttpException` to `ProblemDetailsFilter`,
   maps `DrizzleQueryError` via `database-error-mapper.ts`, renders 500 for everything else

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L146–L150`

```
Any exception
    ↓
ThrottlerException?  →  ThrottlerExceptionFilter (429 + Retry-After)
    ↓ no
HttpException?       →  ProblemDetailsFilter (mapped RFC 9457 body)
    ↓ no
DrizzleQueryError wrapping pg.DatabaseError?
                     →  mapDatabaseError() → ProblemDetailsFilter
    ↓ no
Anything else        →  AllExceptionsFilter (500, message stripped in prod)
```

## Exception Filters

### AllExceptionsFilter

`packages/nest-http/src/filters/all-exceptions.filter.ts`

Catch-all `@Catch()` filter. Dispatch order (L52–L70):

1. `instanceof HttpException` → delegates to `ProblemDetailsFilter`.
2. `instanceof DrizzleQueryError` with a `pg.DatabaseError` cause → calls `mapDatabaseError()`,
   logs a warning with SQLSTATE code and table name, then delegates to `ProblemDetailsFilter`.
3. `DrizzleQueryError` with a non-pg cause → logs breadcrumb, falls through to 500 path.
4. All other errors → 500 Problem Details body. In production, `exception.message` is replaced
   with a static string so stack traces and SQL fragments cannot appear in the response.

`ClsService` and `appConfig` are `@Optional()` (L41–L44) so test harnesses without a full DI
container can still construct the filter. When `appConfig` is absent the filter defaults to
the production-safe path — no message leakage.

### ProblemDetailsFilter

`packages/nest-http/src/filters/problem-details.filter.ts`

`@Catch(HttpException)`. Responsibilities:

- Maps status code → canonical `type` URI (`${API_BASE_URL}/errors/<slug>`) for known codes;
  falls back to `about:blank` for unmapped statuses per RFC 9457 §4.1 (L88–L111).
- Populates tracing identifiers (`request_id`, `correlation_id`, `trace_id`) from the CLS store.
- Translates class-validator failures into structured `errors[]` with `field`, `pointer`, `code`,
  and `message` per entry. Handles both legacy string form and structured `ValidationErrorItem`
  (L212–L252).
- Emits `Content-Type: application/problem+json` and `Cache-Control: no-store` on every error
  response (L76–L78).
- Silently returns `404` with no body for paths in `#silentPaths` (currently `/mockServiceWorker.js`)
  to suppress dev-tool probe noise in logs (L47–L50).

### ThrottlerExceptionFilter

`packages/nest-http/src/filters/throttler-exception.filter.ts`

`@Catch(ThrottlerException)`. Sets rate-limit response headers before writing the Problem Details body:

- `Retry-After` — full TTL window in seconds (RFC 6585 §4, mandatory)
- `X-RateLimit-Limit` — configured limit value
- `X-RateLimit-Remaining` — always `0` (the request that tripped the guard)
- `X-RateLimit-Reset` — Unix timestamp for window reset

## Configuration

| Variable | Description | Source |
|---|---|---|
| `API_BASE_URL` | Base URL prepended to `type` URI paths in error responses | `packages/nest-http/src/config/http.config.ts:L15` |

`API_BASE_URL` must not equal `https://api.example.com` in production (enforced by
`envSchema` superRefine — `packages/shared-kernel/src/config/env.schema.ts:L231`).

## RFC 9457 Envelope Shape

Every error response carries `Content-Type: application/problem+json`. The envelope fields:

```json
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "User with id usr_123 does not exist",
  "instance": "/api/users/usr_123",
  "request_id": "e3f2a1b4-...",
  "correlation_id": "c8d7e6f5-...",
  "trace_id": "4bf92f3577b34da6...",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "code": "RESOURCE_NOT_FOUND",
  "errors": []
}
```

| Field | RFC 9457 ref | Source |
|---|---|---|
| `type` | §3.1.1 — URI reference to human-readable problem type | `problem-details.filter.ts:L88–L93` |
| `title` | §3.1.2 — short human-readable summary | `problem-details.filter.ts:L119–L134` |
| `status` | §3.1.3 — HTTP status code | `problem-details.filter.ts:L44` |
| `detail` | §3.1.4 — human-readable explanation specific to this occurrence | `problem-details.filter.ts:L176–L193` |
| `instance` | §3.1.5 — URI reference identifying the specific occurrence | `problem-details.filter.ts:L64` |
| `request_id` | Extension field — CLS request ID | `problem-details.filter.ts:L65` |
| `correlation_id` | Extension field — CLS correlation ID | `problem-details.filter.ts:L66` |
| `trace_id` | Extension field — W3C Trace Context trace ID | `problem-details.filter.ts:L67` |
| `timestamp` | Extension field — ISO 8601 UTC | `problem-details.filter.ts:L68` |
| `code` | Extension field — machine-readable error code | `problem-details.filter.ts:L184–L193` |
| `errors` | Extension field — field-level validation details | `problem-details.filter.ts:L158–L165` |

For `type` URI slugs, the filter maps:

| HTTP status | `type` slug | `code` fallback |
|---|---|---|
| 400 | `bad-request` | `BAD_REQUEST` |
| 401 | `unauthorized` | `UNAUTHORIZED` |
| 403 | `forbidden` | `FORBIDDEN` |
| 404 | `not-found` | `RESOURCE_NOT_FOUND` |
| 409 | `conflict` | `RESOURCE_CONFLICT` |
| 422 | `validation-failed` | `VALIDATION_FAILED` |
| 429 | `rate-limit-exceeded` | `RATE_LIMIT_EXCEEDED` |
| 500 | `internal-server-error` | `INTERNAL_SERVER_ERROR` |
| 503 | `service-unavailable` | `INTERNAL_SERVER_ERROR` |

All other statuses use `about:blank` as the `type` URI per RFC 9457 §4.1.

### Validation Error Field Shape

When a 400 or 422 carries class-validator failures, the `errors` array contains entries:

```json
{
  "errors": [
    {
      "field": "email",
      "pointer": "/email",
      "code": "VALIDATION_ERROR",
      "message": "email must be an email"
    }
  ]
}
```

`pointer` uses JSON Pointer format (leading `/`); nested DTOs produce dotted paths converted
to slash-delimited pointers (`address.street` → `/address/street`).

Source: `packages/nest-http/src/filters/problem-details.filter.ts:L224–L253`

## Database Error Mapping

`packages/nest-http/src/filters/database-error-mapper.ts`

`mapDatabaseError(error: DatabaseError): HttpException` maps Postgres SQLSTATE codes to HTTP
exceptions. The resulting `HttpException` is then handled by `ProblemDetailsFilter` for a
consistent RFC 9457 body.

| SQLSTATE | Postgres name | HTTP status | `code` |
|---|---|---|---|
| `23505` | unique_violation | 409 Conflict | `RESOURCE_CONFLICT` |
| `23503` | foreign_key_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `23502` | not_null_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `23514` | check_violation | 422 Unprocessable Entity | `CONSTRAINT_VIOLATION` |
| `40001` | serialization_failure | 409 Conflict | `TRANSACTION_CONFLICT` |
| `40P01` | deadlock_detected | 409 Conflict | `TRANSACTION_CONFLICT` |
| `08000/08001/08003/08004/08006` | connection exceptions | 503 Service Unavailable | `INTERNAL_SERVER_ERROR` |
| `57014` | query_canceled (statement_timeout) | 503 Service Unavailable | `INTERNAL_SERVER_ERROR` |
| anything else | — | 500 Internal Server Error | `INTERNAL_SERVER_ERROR` |

`TRANSACTION_CONFLICT` (40001 and 40P01) signals a retryable serialization or deadlock failure.
Clients should back off and retry the full operation — the response `detail` field states this
explicitly: `"Transaction serialization conflict — retry the request"` and
`"Deadlock detected — retry the request"` respectively.

Source: `packages/nest-http/src/filters/database-error-mapper.ts:L63–L74`

## CLS Context in Error Logs

The `AllExceptionsFilter` composes a log prefix from the CLS store at the time of the error:

```
[req:<uuid>|corr:<uuid>|trace:<traceId>] POST /api/users 500
```

Each component is optional — missing IDs are omitted rather than printing empty brackets.
The error is logged at `error` level with the full stack trace for 500s; `ProblemDetailsFilter`
uses `warn` level for 4xx and `error` for 5xx.

Source: `packages/nest-http/src/filters/all-exceptions.filter.ts:L82–L108`,
`packages/nest-http/src/filters/problem-details.filter.ts:L69–L74`

No raw `exception.message` is sent to the client in production for non-HttpException errors —
the detail is replaced with `"The server encountered an unexpected error"`.

Source: `packages/nest-http/src/filters/all-exceptions.filter.ts:L77–L79`

## Usage

### Throwing HTTP Exceptions

Standard NestJS exceptions are caught by `ProblemDetailsFilter` and rendered as RFC 9457 bodies
with the appropriate `type` URI and `code` fallback:

```typescript
import { NotFoundException } from '@nestjs/common'

throw new NotFoundException('User with id usr_123 does not exist')
// → 404, type: "${API_BASE_URL}/errors/not-found", code: "RESOURCE_NOT_FOUND"
```

### Throwing Business Errors with Codes

Pass an explicit `{ code, message }` object to preserve the machine-readable code:

```typescript
import { ConflictException } from '@nestjs/common'

throw new ConflictException({
  code: 'EMAIL_ALREADY_REGISTERED',
  message: 'An account with this email already exists',
})
// → 409, type: "${API_BASE_URL}/errors/conflict", code: "EMAIL_ALREADY_REGISTERED"
```

Source: `packages/nest-http/src/filters/problem-details.filter.ts:L176–L179`

## Creating a New Error Code

1. Throw the appropriate NestJS exception class with an explicit `{ code, message }` payload
   in the domain layer (service or use-case class). No changes to filter code are needed for
   codes that map to an existing HTTP status.

2. If a new HTTP status is needed, add the status → slug entry in `getErrorType()` and the
   status → title entry in `getTitle()` in `ProblemDetailsFilter`.
   Source: `packages/nest-http/src/filters/problem-details.filter.ts:L96–L133`

3. For new database-level error classes, add a `case '<SQLSTATE>':` branch in `mapDatabaseError`.
   Source: `packages/nest-http/src/filters/database-error-mapper.ts`

## Behavior Reference

| Scenario | Response | Notes |
|---|---|---|
| Any `HttpException` | RFC 9457 body, status from exception | `ProblemDetailsFilter` |
| Validation failure (class-validator) | 422 with `errors[]` field details | `code: VALIDATION_FAILED` |
| Unique DB violation (23505) | 409 with `code: RESOURCE_CONFLICT` | `database-error-mapper.ts:L39` |
| Transaction conflict (40001/40P01) | 409 with `code: TRANSACTION_CONFLICT` | Clients should retry |
| DB connection failure (class 08) | 503 with `code: INTERNAL_SERVER_ERROR` | Transient — retry |
| Statement timeout (57014) | 503 with `code: INTERNAL_SERVER_ERROR` | Query exceeded timeout |
| Uncaught throwable — dev | 500, `detail` contains original message | `appCfg.nodeEnv !== 'production'` |
| Uncaught throwable — prod | 500, `detail` is static safe string | `all-exceptions.filter.ts:L79` |
| Rate limit exceeded | 429 + `Retry-After` + `X-RateLimit-*` headers | `ThrottlerExceptionFilter` |

<!-- REFERENCES -->

[ref-rfc-9457]: https://datatracker.ietf.org/doc/html/rfc9457
[ref-rfc-7807]: https://datatracker.ietf.org/doc/html/rfc7807
[ref-rfc-6585]: https://datatracker.ietf.org/doc/html/rfc6585
[ref-pg-errorcodes]: https://www.postgresql.org/docs/current/errcodes-appendix.html
