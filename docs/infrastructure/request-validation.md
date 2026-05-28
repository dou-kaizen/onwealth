# Request Validation Documentation

This documentation explains the two-layer validation system in `@boilerplate/nest-http`:
environment validation at bootstrap via Zod, and request body/query/param validation via
class-validator with NestJS `ValidationPipe`.

## Related Documents

- [Handling Error Documentation](./handling-error.md) — how validation failures become RFC 9457 envelopes
- [Environment Variables](./environment.md) — full env var reference and Zod schema
- [Configuration Documentation](./configuration.md) — NestJS `ConfigModule` integration
- [Response Documentation](./response.md) — response pipeline order

## Table of Contents

- [Overview](#overview)
- [Related Documents](#related-documents)
- [Two-Layer Architecture](#two-layer-architecture)
- [Configuration](#configuration)
- [Structure](#structure)
- [Usage](#usage)
  - [Layer 1: Environment Validation](#layer-1-environment-validation)
  - [Layer 2: Request Validation](#layer-2-request-validation)
  - [DTO Example](#dto-example)
- [Creating a New DTO](#creating-a-new-dto)
- [Behavior Reference](#behavior-reference)
- [References](#references)

## Overview

Validation is applied at two distinct points in the application lifecycle:

| Layer | When | Tool | Failure outcome |
|---|---|---|---|
| Environment | Bootstrap (before any request) | Zod (`envSchema`) | Process exits with field-level errors |
| Request | Per-request, before route handler | class-validator + `ValidationPipe` | 422 RFC 9457 envelope with `errors[]` |

The two layers use different tools by design: Zod is the standard for env validation because its
schema-as-type approach requires no decorators; class-validator is used for DTOs because it
integrates with NestJS `ValidationPipe` and supports incremental class decoration.

## Two-Layer Architecture

### Layer 1: Environment (Zod)

`packages/shared-kernel/src/config/env.schema.ts`

`validateEnv(config)` is wired into `ConfigModule.forRoot({ validate: validateEnv })`. NestJS
calls it during module initialization before the first request is accepted. If any field is
missing or invalid, the process exits with an error message listing every offending field:

```
Environment variable validation failed:
PORT: PORT must be between 1024 and 65535
JWT_SECRET: JWT_SECRET must be at least 32 characters

Please check your .env file or environment variable configuration
```

Source: `packages/shared-kernel/src/config/env.schema.ts:L260–L276`

Individual config factories (`httpConfig`, `throttleConfig`, `databaseConfig`, …) derive subset
schemas via `envObjectSchema.pick({...})` rather than re-declaring field rules. This keeps one
source of truth per field.

Source: `packages/nest-http/src/config/http.config.ts:L12–L16`,
`packages/nest-http/src/config/throttle.config.ts:L13–L16`

### Layer 2: Request (class-validator + ValidationPipe)

`packages/nest-http/src/config/validation.config.ts`

`createValidationPipe()` builds a `ValidationPipe` with a fixed set of options registered
globally via `app.useGlobalPipes()`. The pipe runs before every route handler, after
interceptors have set up tracing context.

Source: `packages/nest-http/src/bootstrap/configure-http-app.ts:L175`

## Configuration

### ValidationPipe options

| Option | Value | Rationale |
|---|---|---|
| `whitelist` | `true` | Strips undeclared properties — defends against mass-assignment |
| `forbidNonWhitelisted` | `true` | 422 on unknown properties instead of silent strip — client learns typo immediately |
| `transform` | `true` | Converts plain object to DTO class instance |
| `enableImplicitConversion` | `false` | `@Type(() => X)` required for coercion; implicit conversion runs before whitelist and can bypass validation |
| `stopAtFirstError` | `false` | Returns all validation errors per field so forms can render every failure at once |
| `errorHttpStatusCode` | `422` | RFC-aligned: Unprocessable Entity for semantic failure; 400 reserved for syntactic/parse errors |
| `exceptionFactory` | `UnprocessableEntityException(errors)` | Explicit 422 status survives downstream filter re-wrapping |

Source: `packages/nest-http/src/config/validation.config.ts:L23–L37`

## Structure

| File | Responsibility |
|---|---|
| `packages/shared-kernel/src/config/env.schema.ts` | `envObjectSchema` (field rules) + `envSchema` (cross-field prod refines) + `validateEnv()` |
| `packages/nest-http/src/config/validation.config.ts` | `createValidationPipe()` factory |
| `packages/nest-http/src/bootstrap/configure-http-app.ts` | Global pipe registration (`app.useGlobalPipes`) |
| `packages/nest-http/src/filters/problem-details.filter.ts` | Translates class-validator failures into `errors[]` in RFC 9457 body |
| `apps/api/src/modules/<domain>/dto/` | DTO classes per domain (convention — not yet populated in M1) |

## Usage

### Layer 1: Environment Validation

No runtime action required in request handling. `validateEnv` is configured once at bootstrap:

```typescript
// apps/api/src/app.module.ts (pattern)
ConfigModule.forRoot({
  validate: validateEnv,
  isGlobal: true,
})
```

To add a new env var, add its field to `envObjectSchema` in `env.schema.ts`. If the field needs
cross-field production rules (e.g. "must use TLS in prod"), add a `superRefine` check in
`envSchema` in the same file. Do not add the rule in `envObjectSchema` — that object-schema
cannot be `.pick()`'d after `.superRefine()`.

Source: `packages/shared-kernel/src/config/env.schema.ts:L9–L14`

### Layer 2: Request Validation

Annotate the DTO class with class-validator decorators and use `@Body()`, `@Query()`, or
`@Param()` with the DTO type. The globally registered `ValidationPipe` handles the rest.

### DTO Example

```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateUserDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(8)
  password: string

  @IsOptional()
  @IsString()
  displayName?: string
}
```

```typescript
@Post()
@HttpCode(201)
async create(@Body() dto: CreateUserDto): Promise<UserDto> {
  return this.usersService.create(dto)
}
```

When validation fails, the pipe throws `UnprocessableEntityException(errors)` where `errors`
is the class-validator `ValidationError[]`. `ProblemDetailsFilter` translates this into the
RFC 9457 envelope:

```json
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Request validation failed",
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "field": "email",
      "pointer": "/email",
      "code": "VALIDATION_ERROR",
      "message": "email must be an email"
    },
    {
      "field": "password",
      "pointer": "/password",
      "code": "VALIDATION_ERROR",
      "message": "password must be longer than or equal to 8 characters"
    }
  ]
}
```

Source: `packages/nest-http/src/filters/problem-details.filter.ts:L157–L165`,
`packages/nest-http/src/filters/problem-details.filter.ts:L212–L253`

## Creating a New DTO

1. Create a file in `apps/api/src/modules/<domain>/dto/<action>-<entity>.dto.ts`
   (e.g. `create-user.dto.ts`).

2. Declare class properties with class-validator decorators. Use `@Type(() => NestedDto)` from
   `class-transformer` for any nested object — `enableImplicitConversion: false` means the pipe
   will not coerce nested objects without an explicit `@Type()`.

3. For query params that arrive as strings, use `@Type(() => Number)` or `@Type(() => Boolean)`
   alongside the appropriate validator (`@IsInt()`, `@IsBoolean()`).

4. For optional fields, use `@IsOptional()` as the first decorator. Without it, an absent field
   will fail the presence check even if the type is `T | undefined`.

5. Unknown properties are rejected with 422 (`forbidNonWhitelisted: true`). This is intentional —
   do not add `@Allow()` to bypass it; instead, declare every intended field.

6. Nested DTOs require `@ValidateNested()` + `@Type(() => NestedDto)` for the pipe to recurse
   into the nested class. Nested validation failures emit dotted paths (`address.street`) which
   are converted to JSON Pointer format (`/address/street`) in the `errors[]` array.

Source: `packages/nest-http/src/filters/problem-details.filter.ts:L243–L249`

## Behavior Reference

| Scenario | Outcome | Source |
|---|---|---|
| All fields valid | DTO class instance passed to handler | `validation.config.ts:L26` |
| Unknown property present | 422, `code: VALIDATION_FAILED`, field listed in `errors[]` | `validation.config.ts:L27` |
| Field fails validator constraint | 422, all failing fields listed in `errors[]` | `validation.config.ts:L30` |
| Nested DTO fails | 422, dotted path in `field`, slash path in `pointer` | `problem-details.filter.ts:L243` |
| Missing required env var at boot | Process exits, field-level error message printed | `env.schema.ts:L260` |
| Env var fails prod cross-field refine | Process exits with specific message | `env.schema.ts:L148–L238` |
| `ALLOWED_ORIGINS` contains `*` or `null` | Schema parse error at boot — any env, not prod-only | `env.schema.ts:L85–L87` |
| `THROTTLE_TTL` < 1000 | Schema parse error at boot | `env.schema.ts:L115–L118` |
| `JWT_SECRET` < 32 chars | Schema parse error at boot | `env.schema.ts:L108` |

<!-- REFERENCES -->

[ref-class-validator]: https://github.com/typestack/class-validator
[ref-class-transformer]: https://github.com/typestack/class-transformer
[ref-rfc-9457]: https://datatracker.ietf.org/doc/html/rfc9457
[ref-zod]: https://zod.dev
