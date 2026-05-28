# Infrastructure Documentation

This documentation covers every infrastructure concern in **boilerplate-monorepo**: the
NestJS monorepo foundation providing database, cache, queue, HTTP cross-cutting, logging,
and security layers that all future domain modules build on. Source packages live under
`packages/shared-kernel/`, `packages/nest-http/`, and `packages/database/`.

## Related Documents

- [System Architecture](../system-architecture.md)
- [Codebase Summary](../codebase-summary.md)
- [Deployment Guide](../deployment-guide.md)

## Standards

The infrastructure layer is built against the following standards. Every claim in this
table is verified against an actual source file; the filepath column cites the primary
implementation location.

### Methodology

| Concern | Standard | Source location |
|---|---|---|
| Codebase methodology | [12-Factor App][ref-12factor] | Conceptual: stateless process, env-based config, explicit dependency manifest |

### HTTP Standards

| Concern | Standard | Source location |
|---|---|---|
| HTTP error responses | [RFC 9457][ref-rfc-9457] Problem Details for HTTP APIs | `packages/nest-http/src/filters/all-exceptions.filter.ts` |
| HTTP caching | [RFC 9110][ref-rfc-9110] §8.8 ETag weak comparison | `packages/nest-http/src/middleware/etag.middleware.ts` |
| HTTP pagination | [RFC 8288][ref-rfc-8288] Web Linking (`Link` header) | `packages/nest-http/src/interceptors/link-header-builder.ts` |

### Security Standards

| Concern | Standard | Source location |
|---|---|---|
| HTTP security headers | [Helmet][ref-helmet] | `packages/nest-http/src/config/security.config.ts` |
| Rate limiting | [@nestjs/throttler][ref-throttler] | `packages/nest-http/src/config/throttle.config.ts` |
| Threat coverage | [OWASP Top 10][ref-owasp] | Env validation (`env.schema.ts`), header redaction, CORS allowlist |

### Observability and Data

| Concern | Standard | Source location |
|---|---|---|
| Structured logging | [pino][ref-pino] JSON | `packages/shared-kernel/src/logger/logger.config.ts` |
| Database ORM | [Drizzle ORM][ref-drizzle] + [pg][ref-pg] driver | `packages/database/` |

## Table of Contents

### Getting Started

- [Installation](./installation.md) — prerequisites, quick start, verification
- [Environment Variables](./environment.md) — all env vars, Zod validation, production rules
- [Configuration](./configuration.md) — NestJS ConfigModule, namespaced config factories
- [Project Structure](./project-structure.md) — monorepo layout, package boundaries, dependency DAG

### Core

- [Database](./database.md) — Drizzle ORM, pg pool, migration workflow
- [Cache](./cache.md) — Redis integration, CachePort abstraction, TTL policy
- [Queue](./queue.md) — BullMQ, queue config, processor pattern
- [Logger](./logger.md) — nestjs-pino, redaction, log levels, CLS correlation

### HTTP Layer

- [Response](./response.md) — envelope interceptor, pagination response, ListResponseDto
- [Request Validation](./request-validation.md) — ValidationPipe, class-validator, 422 semantics
- [Handling Error](./handling-error.md) — AllExceptions filter, RFC 9457 Problem Details shape
- [Security and Middleware](./security-and-middleware.md) — Helmet, CORS, throttler, ETag, CLS



<!-- REFERENCES -->

[ref-12factor]: https://12factor.net
[ref-rfc-9457]: https://datatracker.ietf.org/doc/html/rfc9457
[ref-rfc-9110]: https://datatracker.ietf.org/doc/html/rfc9110
[ref-rfc-8288]: https://datatracker.ietf.org/doc/html/rfc8288
[ref-helmet]: https://helmetjs.github.io
[ref-throttler]: https://github.com/nestjs/throttler
[ref-owasp]: https://owasp.org/www-project-top-ten/
[ref-pino]: https://getpino.io
[ref-drizzle]: https://orm.drizzle.team
[ref-pg]: https://node-postgres.com
