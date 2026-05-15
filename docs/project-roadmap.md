# Project Roadmap

_Last updated: 2026-05-15 | Branch: init-infrastructure_

## Phase 1 — Infrastructure Foundation

**Status: Complete**

- [x] pnpm + Turborepo monorepo scaffold
- [x] 4 workspace packages + 1 app: `@onwealth/core`, `@onwealth/database`, `@onwealth/platform`, `@onwealth/tsconfig` + `apps/api`
- [x] `@onwealth/api` app with full middleware chain
- [x] Zod env validation (`env.schema.ts`)
- [x] Pino structured logging with W3C trace propagation
- [x] RFC 9457 problem+json error responses
- [x] Google AIP-193 response envelope (`@UseEnvelope()`)
- [x] Rate limiting (`@nestjs/throttler` + env-driven config)
- [x] Drizzle + node-postgres `DatabaseModule`
- [x] `dependency-cruiser` 16 architectural boundary enforcement (6 error-severity rules)
- [x] oxlint + oxfmt via `@infra-x/code-quality` presets
- [x] `GET /health` smoke endpoint
- [x] **Foundation Hardening** (2026-05-04): graceful shutdown, security defaults, operational tuning, error contract refinement, trace hardening, tooling correctness (6-phase pass)
- [x] OpenAPI / Swagger documentation (Swagger UI `/swagger`, Scalar `/docs`, JSON `/swagger-json`, YAML `/openapi.yaml`; env-gated via `ENABLE_SWAGGER`)

## Phase 2 — Authentication (planned)

- [ ] JWT access + refresh token flow
- [ ] `@nestjs/passport` or custom auth guard
- [ ] User entity + `@onwealth/database` schema
- [ ] `/auth/login`, `/auth/refresh`, `/auth/logout` endpoints
- [ ] `JWT_SECRET` / `JWT_EXPIRES_IN` env vars (schema already defined)
- [ ] DDD layer rules in `.dependency-cruiser.cjs`

## Phase 3 — Core Feature Domains (planned)

- [ ] First bounded context module under `apps/api/src/modules/{context}/`
- [ ] `@nestjs/terminus` health indicators (readiness + liveness probes)
- [ ] Redis-backed throttler store (`REDIS_URL` env already defined)
- [ ] Event bus wiring for `DomainEvent` / `IntegrationEvent` (`@onwealth/core`)

## Phase 4 — Production Readiness (planned)

- [ ] Drizzle migrations pipeline
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Docker + docker-compose for local dev
- [ ] Deployment guide (`docs/deployment-guide.md`)
- [ ] Design system / API design guidelines (`docs/design-guidelines.md`)
