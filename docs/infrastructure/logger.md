# Logger Documentation

This documentation explains the logging layer of **boilerplate-monorepo**: `nestjs-pino`
structured JSON logging with request-context correlation, sensitive-field redaction, and a
Nest 11 / Express 5 compatible `forRoutes` override.

Source location: `packages/shared-kernel/src/logger/`

## Related Documents

- [Environment Variables](./environment.md) — `NODE_ENV` reference (drives log level)
- [Configuration](./configuration.md) — `ConfigService` usage pattern
- [Security and Middleware](./security-and-middleware.md) — CLS context, header injection
- [Project Structure](./project-structure.md) — package boundaries and dependency DAG

## Table of Contents

- [Configuration](#configuration)
- [Structure](#structure)
- [Usage](#usage)
- [Creating a New Redaction Path](#creating-a-new-redaction-path)
- [Behavior](#behavior)
- [References](#references)

## Configuration

### Environment Variables

Log level is derived from `NODE_ENV`, which is validated by `envObjectSchema`. There is no
separate `LOG_LEVEL` variable — the mapping is:

| `NODE_ENV` | pino level | Rationale |
|---|---|---|
| `production` | `info` | Operational signal only; debug noise suppressed |
| `development` | `debug` | Full visibility while iterating |
| `test` | `warn` | Suppress test-run noise |

`NODE_ENV` defaults to `'development'` when absent. See [Environment Variables](./environment.md).

### `LoggerConfigOptions`

`LoggerModule.forRoot(options?)` accepts an optional `LoggerConfigOptions` object:

| Field | Type | Default | Notes |
|---|---|---|---|
| `excludePaths` | `Params['exclude']` | `[]` | High-frequency probe routes excluded from access logs (e.g. `/health`) |
| `autoLoggingUrlPrefix` | `string` | `'/api/'` | Requests not starting with this prefix are suppressed from access logs |

These options are intentionally route-agnostic — the logger module stays reusable by
non-HTTP NestJS apps (e.g. a worker) without dragging in HTTP route definitions.

## Structure

| File | Purpose |
|---|---|
| `logger.module.ts` | `LoggerModule.forRoot(options?)` — dynamic module wrapper |
| `logger.config.ts` | `createLoggerConfig(config, options)` — pino config builder |
| `redaction.config.ts` | `redactPaths` array + `redactCensor` constant |

## Usage

### Registering the Module

Call `LoggerModule.forRoot()` once in `AppModule`, before other modules that emit logs
during initialization. Pass `excludePaths` for health-check routes to keep access logs
clean.

```typescript
import { LoggerModule } from '@boilerplate/shared-kernel'

@Module({
  imports: [
    LoggerModule.forRoot({
      excludePaths: [{ path: '/health', method: RequestMethod.GET }],
    }),
    ...
  ],
})
export class AppModule {}
```

### Injecting the Logger

Use either `Logger` from `nestjs-pino` or `Logger` from `@nestjs/common` — both resolve
to the pino-backed implementation when `LoggerModule` is active.

```typescript
import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  async create(dto: CreateUserDto): Promise<void> {
    this.logger.log('Creating user', { email: dto.email })
    // ...
  }
}
```

### Structured Log Shape

Every log line emitted in production is a JSON object. Key fields added automatically by
`createLoggerConfig`:

| Field | Source | Notes |
|---|---|---|
| `msg` | Logger call | The message string |
| `context` | `Logger` class name | Set by `new Logger(ClassName.name)` |
| `level` | pino | `info`, `warn`, `error`, `debug` |
| `correlationId` | `x-correlation-id` header | Sanitized via `sanitizeHeaderValue` |
| `requestId` | `x-request-id` header | Sanitized via `sanitizeHeaderValue` |
| `traceId` | `traceparent` header | Parsed via W3C Trace Context rules; `undefined` if invalid |
| `req` | pino-http serializer | `{ id, method, url, query, params, remoteAddress, remotePort }` |
| `res` | pino-http serializer | `{ statusCode }` |

In development, output goes through `pino-pretty` (colorized, single-line, time as
`HH:MM:ss`). In production, raw JSON is emitted for ingestion pipelines.

## Creating a New Redaction Path

All sensitive paths are listed in `redaction.config.ts`:

```
packages/shared-kernel/src/logger/redaction.config.ts
```

To redact a new field, add its pino path expression to the `redactPaths` array. Path
syntax follows pino's `redact.paths` — supports `*` wildcards for any nesting depth.

Examples of valid path expressions:

```
'req.headers["x-internal-token"]'   // explicit header
'*.newSecret'                        // any object at any depth with key newSecret
'res.body.internalToken'             // explicit response body field
```

Redaction is applied at serialization time (write time), not at the call site. Adding a
path here covers every log line that would serialize that field — no changes needed at
individual `logger.log()` call sites.

The censor value substituted for matched paths is `'[REDACTED]'` (`redactCensor` constant).

## Behavior

### Redaction Coverage

`redactPaths` is intentionally over-broad to fail-closed on new payload shapes:

**Request headers (explicit):**
- `req.headers.authorization`
- `req.headers.cookie`
- `req.headers["x-api-key"]`
- `req.headers["x-auth-token"]`

**Generic credentials (wildcard — any depth):**
`*.password`, `*.confirmPassword`, `*.oldPassword`, `*.newPassword`, `*.token`,
`*.accessToken`, `*.refreshToken`, `*.secret`, `*.apiKey`, `*.privateKey`,
`*.creditCard`, `*.cardNumber`, `*.cvv`, `*.ssn`

**Request/response body (explicit):**
`req.body.password`, `req.body.confirmPassword`, `req.body.token`, `req.body.secret`,
`res.body.token`, `res.body.accessToken`, `res.body.refreshToken`

**Response header:**
`res.headers["set-cookie"]` — prevents session cookies from appearing in access logs

**Redis/ioredis connection objects:**
`*.connectionOptions.password`, `*.options.password`, `*.connection.password`,
`*.redisOpts.password` — closes the credential-leak path where ioredis logs full
connection options on a reconnect error

### Nest 11 / Express 5 `forRoutes` Override

`nestjs-pino` defaults `forRoutes` to `[{ path: '*', method: ALL }]`. Combined with
`setGlobalPrefix('api')`, this resolves to `/api/*` and trips Nest 11's
`LegacyRouteConverter` on path-to-regexp v8 (Express 5), which rejects bare `*` wildcards.

`createLoggerConfig` explicitly sets:

```typescript
forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }]
```

The `{*path}` syntax is the named wildcard form required by path-to-regexp v8. Do not
revert this to bare `*` when upgrading dependencies.

### Header Sanitization

`customProps` in `createLoggerConfig` extracts tracing IDs from request headers and passes
them through `sanitizeHeaderValue`, which strips CR, LF, TAB, NUL, and ANSI escape
sequences. This closes the log-injection attack surface where a malicious client injects
terminal control codes via `x-correlation-id` or similar headers.

`traceparent` is further validated against W3C Trace Context rules (4 dash-separated hex
segments, version `!= 'ff'`, non-zero trace-id) before being logged. Invalid values
produce `undefined` rather than a malformed trace ID in the log record.

### Auto-Logging Suppression

Requests whose URL does not start with `autoLoggingUrlPrefix` (default `'/api/'`) are
suppressed from access logs. This silences container liveness probes, static asset
requests, and other non-API traffic without requiring an explicit `excludePaths` entry per
route. Pass a custom prefix via `LoggerModule.forRoot({ autoLoggingUrlPrefix: '/v2/' })`
to adjust.

## References

[ref-pino]: https://getpino.io
[ref-nestjs-pino]: https://github.com/iamolegga/nestjs-pino
[ref-w3c-trace]: https://www.w3.org/TR/trace-context/
[ref-path-to-regexp]: https://github.com/pillarjs/path-to-regexp
