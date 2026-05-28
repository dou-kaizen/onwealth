# Response Documentation

This documentation explains the standardized HTTP response pipeline in `@boilerplate/nest-http`:
the `TransformInterceptor` list-envelope, `LocationHeaderInterceptor` for 201 Created,
`LinkHeaderInterceptor` for RFC 8288 pagination, and `ETagMiddleware` for RFC 9110 conditional
GET. Error responses are handled separately — see [Handling Error](./handling-error.md).

## Related Documents

- [Handling Error Documentation](./handling-error.md) — RFC 9457 envelope for error responses
- [Request Validation Documentation](./request-validation.md) — how validation failures enter the pipeline
- [Security and Middleware Documentation](./security-and-middleware.md) — pipeline registration order
- [Configuration Documentation](./configuration.md) — `httpConfig` namespace

## Table of Contents

- [Overview](#overview)
- [Related Documents](#related-documents)
- [Configuration](#configuration)
- [Structure](#structure)
- [Pipeline Execution Order](#pipeline-execution-order)
- [Usage](#usage)
  - [Single-Resource Response](#single-resource-response)
  - [List Response with Envelope](#list-response-with-envelope)
  - [Location Header on 201 Created](#location-header-on-201-created)
  - [Link Header for Pagination](#link-header-for-pagination)
  - [ETag and Conditional GET](#etag-and-conditional-get)
- [Creating a New Response Variant](#creating-a-new-response-variant)
- [Behavior Reference](#behavior-reference)
- [References](#references)

## Overview

Successful responses pass through a chain of interceptors before reaching the ETag middleware.
The chain enforces three contracts:

1. **Shape** — list payloads are wrapped in `{ object: 'list', data: [...] }` via `@UseEnvelope()`.
2. **Location** — `201 Created` responses emit a `Location` header pointing at the new resource URI.
3. **Pagination** — list responses with pagination metadata emit an RFC 8288 `Link` header plus
   `X-Total-Count` / `X-Page-Count` for offset pagination clients.
4. **Caching** — GET/HEAD responses receive a content-hash `ETag`; `If-None-Match` matching
   returns `304 Not Modified` without a body.

## Configuration

| Variable | Description | Config namespace |
|---|---|---|
| `API_BASE_URL` | Base URL used to compose `Location` URIs and `Link` header URLs | `httpConfig.apiBaseUrl` |
| `PORT` | Listening port (used in startup banner only) | `httpConfig.port` |
| `ALLOWED_ORIGINS` | CORS origin list; exposed headers include `ETag`, `Link`, `Location` | `httpConfig.allowedOrigins` |

`API_BASE_URL` is the canonical external origin. It is used instead of `request.protocol` /
`request.get('host')` because both are attacker-influenced behind a reverse proxy.

Source: `packages/nest-http/src/interceptors/location-header.interceptor.ts:L19–L23`,
`packages/nest-http/src/interceptors/link-header.interceptor.ts:L22–L26`

## Structure

| Component | File | Responsibility |
|---|---|---|
| `TransformInterceptor` | `interceptors/transform.interceptor.ts` | Wraps array returns in list envelope when `@UseEnvelope()` is present |
| `LocationHeaderInterceptor` | `interceptors/location-header.interceptor.ts` | Emits `Location` header on 201 Created |
| `LinkHeaderInterceptor` | `interceptors/link-header.interceptor.ts` | Emits RFC 8288 `Link` header on paginated list responses |
| `link-header-builder.ts` | `interceptors/link-header-builder.ts` | Pure functions for building RFC 8288 link strings; independently unit-tested |
| `ETagMiddleware` | `middleware/etag.middleware.ts` | Computes content-hash ETag; handles `If-None-Match` |
| `ProblemDetailsFilter` | `filters/problem-details.filter.ts` | Renders RFC 9457 body for every `HttpException` |
| `AllExceptionsFilter` | `filters/all-exceptions.filter.ts` | Catch-all; routes database errors and 500s |

## Pipeline Execution Order

NestJS processes a request through filters (on the error path) and interceptors (on the success
path) in the following order. Middleware runs outside the Nest lifecycle, on every request.

```
Inbound request
    │
    ▼
CLS middleware (request context population)
    │
    ▼
ETagMiddleware (intercepts res.json for GET/HEAD)
    │
    ▼  ← Nest request pipeline begins
RequestContextInterceptor  (tracing headers on response)
CorrelationIdInterceptor   (X-Correlation-Id echo)
TraceContextInterceptor    (W3C Trace Context propagation)
TimeoutInterceptor         (30 s hard timeout)
LocationHeaderInterceptor  (Location on 201)
LinkHeaderInterceptor      (Link on paginated lists)
TransformInterceptor       (list envelope)
    │
    ▼
Route handler
    │
    ▼ (error path — filters in reversed registration order)
ThrottlerExceptionFilter → ProblemDetailsFilter → AllExceptionsFilter
```

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L135–L173`

## Usage

### Single-Resource Response

Return any object directly. The `TransformInterceptor` passes it through unchanged when
`@UseEnvelope()` is absent:

```typescript
@Get(':id')
async findOne(@Param('id') id: string): Promise<UserDto> {
  return this.usersService.findOne(id)
}
// Response body: { "id": "usr_123", "email": "..." }
```

### List Response with Envelope

Decorate the handler (or the entire controller) with `@UseEnvelope()`. The interceptor wraps
the returned array in `{ object: 'list', data: [...] }`. Returning a non-array with
`@UseEnvelope()` throws `InternalServerErrorException` at request time — a deliberate fail-fast
to catch controller bugs early.

```typescript
import { UseEnvelope } from '@boilerplate/nest-http'

@Get()
@UseEnvelope()
async findAll(): Promise<UserDto[]> {
  return this.usersService.findAll()
}
// Response body: { "object": "list", "data": [...] }
```

Source: `packages/nest-http/src/interceptors/transform.interceptor.ts:L37–L58`

### Location Header on 201 Created

When a handler returns `201 Created` and the response body has an `id` field, the
`LocationHeaderInterceptor` automatically sets the `Location` header:

```
POST /api/users
→ 201 Created
  Location: https://api.example.com/api/users/usr_456
  { "id": "usr_456", "email": "..." }
```

The interceptor composes the URL from `apiBaseUrl` origin + request path + encoded resource id.
`encodeURIComponent` guards against path traversal in raw ids.

Source: `packages/nest-http/src/interceptors/location-header.interceptor.ts:L56–L73`

No explicit action is needed in the controller beyond returning the created resource with its `id`.
The interceptor silently skips when status is not 201 or when `id` is absent.

### Link Header for Pagination

The `LinkHeaderInterceptor` activates when the response body duck-types as a list envelope
(`{ object: 'list', data: [...] }`). It is currently a stub — **active when M2 paginated
endpoints land**. The builder logic in `link-header-builder.ts` is fully implemented and
unit-tested.

Two pagination shapes are supported:

**Offset pagination** — response body must include `total`, `page`, `pageSize`, `hasMore`.
Emits `first`, `prev`, `self`, `next`, `last` relations as applicable, plus:
- `X-Total-Count` — total record count
- `X-Page-Count` — total page count

**Cursor pagination** — response body must include `hasMore` and optionally `nextCursor`.
Emits `self` and (when `hasMore && nextCursor`) `next`. No backward links — cursor walks
are one-way.

Source: `packages/nest-http/src/interceptors/link-header-builder.ts:L108–L151`

Example `Link` header for offset pagination (page 2 of 5):

```
Link: <https://api.example.com/api/users?page=1&pageSize=20>; rel="first",
      <https://api.example.com/api/users?page=1&pageSize=20>; rel="prev",
      <https://api.example.com/api/users?page=2&pageSize=20>; rel="self",
      <https://api.example.com/api/users?page=3&pageSize=20>; rel="next",
      <https://api.example.com/api/users?page=5&pageSize=20>; rel="last"
```

Multi-value query params (e.g. `?status=active&status=pending`) are preserved in generated
link URLs via `URLSearchParams.append` rather than `set`.

Source: `packages/nest-http/src/interceptors/link-header-builder.ts:L66–L88`

### ETag and Conditional GET

The `ETagMiddleware` applies to every GET and HEAD response. It intercepts `res.json`, computes
an MD5 hash of the serialized body, and sets `ETag: "<hash>"`.

On subsequent requests, the client sends `If-None-Match: "<hash>"`. The middleware strips any
`W/` prefix before comparison per RFC 9110 §8.8.3 weak comparison, so proxy-rewritten weak
ETags still match the strong ETags this middleware generates:

```
// First request
GET /api/users/usr_123
→ 200 OK
  ETag: "33a64df551425fcc55e4d42a148795d9"
  { "id": "usr_123", ... }

// Conditional request
GET /api/users/usr_123
If-None-Match: W/"33a64df551425fcc55e4d42a148795d9"
→ 304 Not Modified
  ETag: "33a64df551425fcc55e4d42a148795d9"
```

Source: `packages/nest-http/src/middleware/etag.middleware.ts:L85–L94`

The `W/` strip logic:

```typescript
const normalise = (e: string) => (e.startsWith('W/') ? e.slice(2) : e)
const etags = new Set(ifNoneMatch.split(',').map((e) => normalise(e.trim())))
if (etags.has(etag) || etags.has('*')) {
  return res.status(304).end()
}
```

Source: `packages/nest-http/src/middleware/etag.middleware.ts:L89–L93`

The middleware also handles `If-None-Match: *` (matches any ETag — treated as a cache hit).

**ETag bypass conditions:**
- Methods other than GET / HEAD pass through without ETag logic.
- Responses with status `>= 400` (error bodies carrying `request_id`/`trace_id`) are never
  tagged — those responses must not be cached.
- If the route handler already set an `ETag` header (e.g. optimistic-lock version), it is
  reused verbatim rather than overwritten.

Source: `packages/nest-http/src/middleware/etag.middleware.ts:L47–L49`, `L73–L79`

`Cache-Control` defaults to `no-store` when the handler did not set one. Opt-in caching:
add `@Header('Cache-Control', 'max-age=60')` on the route handler.

## Creating a New Response Variant

To add a new response header that depends on the response body, add a new interceptor:

1. Create the interceptor in `packages/nest-http/src/interceptors/`.
2. Inject `httpConfig` via `@Inject(httpConfig.KEY)` when you need the `apiBaseUrl` for URL
   composition — never read `request.protocol` or `request.get('host')` (proxy-influenced).
3. Register the interceptor in `configureHttpApp` in the correct position within
   `app.useGlobalInterceptors(...)`. Interceptors execute in registration order.
4. Add the response header name to `exposedHeaders` in `createCorsConfig()` if clients need to
   read it cross-origin.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L165–L173`,
`packages/nest-http/src/config/security.config.ts:L57–L69`

## Behavior Reference

| Scenario | Outcome | Source |
|---|---|---|
| Handler returns `T` (no `@UseEnvelope`) | Body returned as-is | `transform.interceptor.ts:L49` |
| Handler returns `T[]` with `@UseEnvelope` | Wrapped: `{ object: 'list', data: [...] }` | `transform.interceptor.ts:L52` |
| `@UseEnvelope` + non-array return | `InternalServerErrorException` at request time | `transform.interceptor.ts:L54` |
| Handler returns `null`/`undefined` | Passed through; Nest decides 204 | `transform.interceptor.ts:L45` |
| Handler returns `StreamableFile` or `Buffer` | Passed through (binary/SSE) | `transform.interceptor.ts:L46–L47` |
| `201 Created` with `id` field | `Location` header set | `location-header.interceptor.ts:L43–L59` |
| `201 Created` without `id` | `Location` silently skipped | `location-header.interceptor.ts:L44` |
| List body with pagination fields | `Link` header + count headers set | `link-header.interceptor.ts:L39–L57` |
| GET with matching `If-None-Match` | `304 Not Modified`, no body | `etag.middleware.ts:L91` |
| GET with `W/`-prefixed `If-None-Match` | `W/` stripped before compare; 304 if match | `etag.middleware.ts:L89` |
| Error response (`status >= 400`) | ETag skipped, `Cache-Control: no-store` | `etag.middleware.ts:L73` |

<!-- REFERENCES -->

[ref-rfc-9457]: https://datatracker.ietf.org/doc/html/rfc9457
[ref-rfc-9110]: https://datatracker.ietf.org/doc/html/rfc9110
[ref-rfc-8288]: https://datatracker.ietf.org/doc/html/rfc8288
