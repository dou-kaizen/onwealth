# Configuration Documentation

This documentation explains the configuration system for **boilerplate-monorepo**.
Configuration is built on [NestJS ConfigModule][ref-nestjs-config] using the `registerAs`
factory pattern to produce typed, namespaced config objects. Each namespace validates only
the env vars it actually uses, derived from a shared `envObjectSchema` via `.pick()`.

## Related Documents

- [Environment Variables][ref-doc-environment]
- [Database](./database.md)
- [Cache](./cache.md)
- [Queue](./queue.md)
- [Logger](./logger.md)

## Table of Contents

- [Overview](#overview)
- [Config Namespaces](#config-namespaces)
- [Self-Loading Pattern](#self-loading-pattern)
- [Usage](#usage)
- [Creating a New Config Namespace](#creating-a-new-config-namespace)
- [Behavior](#behavior)

## Overview

All runtime configuration flows through environment variables validated by Zod schemas
defined in `packages/shared-kernel/src/config/env.schema.ts`. The `ConfigModule.forRoot`
call in the HTTP app wires `validateEnv` as the validation gate — the full cross-field
schema runs once at startup, failing fast on any violation.

Individual packages and modules load only the slice they need via namespaced config
factories. Each factory calls `envObjectSchema.pick({ ... }).parse(process.env)` directly,
so a worker process that imports only `databaseConfig` never requires `JWT_SECRET` or
`API_BASE_URL` to be present.

## Config Namespaces

The table below lists every `registerAs` namespace currently wired in the codebase, its
config key, the factory source, and the shape it exposes through `ConfigService`.

| Namespace key | Factory | Source file | Exposed shape |
|---|---|---|---|
| `app` | `appConfig` | `packages/shared-kernel/src/config/app.config.ts` | `{ nodeEnv }` |
| `database` | `databaseConfig` | `packages/shared-kernel/src/config/database.config.ts` | `{ url, pool: { max, min, idleTimeoutMillis, connectionTimeoutMillis } }` |
| `redis` | `redisConfig` | `packages/shared-kernel/src/config/redis.config.ts` | `{ url, ttl }` |
| `queue` | `queueConfig` | `packages/shared-kernel/src/queue/queue.config.ts` | `{ url }` |
| `http` | `httpConfig` | `packages/nest-http/src/config/http.config.ts` | `{ port, allowedOrigins, apiBaseUrl }` |
| `throttle` | `throttleConfig` | `packages/nest-http/src/config/throttle.config.ts` | `{ ttl, limit }` |

Additional configs in `packages/nest-http/src/config/` are plain factory functions (not
`registerAs` namespaces) consumed directly during HTTP app bootstrap:

| Factory function | Source file | Purpose |
|---|---|---|
| `createCorsConfig` | `security.config.ts` | Builds `CorsOptions` for `app.enableCors()` |
| `createValidationPipe` | `validation.config.ts` | Builds global `ValidationPipe` |
| `createClsConfig` | `cls.config.ts` | Builds nestjs-cls module options |
| `setupSwagger` | `swagger.config.ts` | Mounts Scalar + Swagger UI routes (non-prod only) |
| `createLoggerConfig` | `packages/shared-kernel/src/logger/logger.config.ts` | Builds nestjs-pino options |

## Self-Loading Pattern

Modules self-contain their config wiring via `ConfigModule.forFeature`. This keeps the
root `AppModule` minimal — each package registers its own config namespace when it is
imported.

Example from `DrizzleModule` (conceptual illustration):

```typescript
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [DrizzleService],
  exports: [DrizzleService],
})
export class DrizzleModule {}
```

The consuming app imports `DrizzleModule`; `databaseConfig` is registered automatically.
No root `AppModule` change is needed when a new package-level module is added.

## Usage

Inject a typed namespace config in any provider:

```typescript
import type { ConfigType } from '@nestjs/config'
import { databaseConfig } from '@boilerplate/shared-kernel'

@Injectable()
export class SomeService {
  constructor(
    @Inject(databaseConfig.KEY)
    private readonly dbCfg: ConfigType<typeof databaseConfig>,
  ) {}

  getPoolMax(): number {
    return this.dbCfg.pool.max   // typed: number
  }
}
```

`ConfigType<typeof databaseConfig>` infers the exact return type of the factory, giving
full TypeScript autocompletion on every config field without manual interface duplication.

## Creating a New Config Namespace

Follow these four steps to add a new namespaced config:

**1. Add env vars to `envObjectSchema`**

Open `packages/shared-kernel/src/config/env.schema.ts` and add the new field(s) to
`envObjectSchema`. Do not add fields anywhere else — all per-namespace schemas derive
from this object via `.pick()`.

**2. Create the namespace factory**

```typescript
// packages/shared-kernel/src/config/my-feature.config.ts
import { registerAs } from '@nestjs/config'
import { envObjectSchema } from './env.schema.js'

export const myFeatureEnvSchema = envObjectSchema.pick({
  MY_FEATURE_VAR: true,
})

export const myFeatureConfig = registerAs('myFeature', () => {
  const env = myFeatureEnvSchema.parse(process.env)
  return {
    someValue: env.MY_FEATURE_VAR,
  }
})
```

**3. Register in the consuming module**

```typescript
@Module({
  imports: [ConfigModule.forFeature(myFeatureConfig)],
})
export class MyFeatureModule {}
```

**4. Update documentation**

Add the new namespace to the Config Namespaces table above and add the new env var(s) to
`docs/infrastructure/environment.md`.

## Behavior

**Missing required env var** — `envSchema.parse(process.env)` or the per-namespace
`.parse(process.env)` throws a `ZodError` before the NestJS module graph is built.
The HTTP app wires this through `validateEnv` which re-throws as a plain `Error` with
a human-readable field list. The process exits non-zero.

**Type safety** — `ConfigType<typeof xConfig>` is the inferred return type of the factory
function. This means adding a field to the factory's return object immediately propagates
to all injection sites via TypeScript — no manual interface maintenance needed.

**Subset schemas** — `databaseConfig`, `redisConfig`, `queueConfig`, and `throttleConfig`
each parse only their own subset of `envObjectSchema`. A non-HTTP worker importing only
`databaseConfig` does not need `JWT_SECRET`, `API_BASE_URL`, or any other HTTP-only var
to be present in its environment.

**`REDIS_TTL` unit** — `redisConfig` exposes `ttl` in **seconds** (the raw env var value).
Consumers that feed millisecond-based libraries (e.g. Keyv) multiply by 1000 at the
boundary. This keeps the env var human-readable (`3600` = 1 hour) while remaining
explicit about unit conversion.



<!-- REFERENCES -->

[ref-doc-environment]: ./environment.md
[ref-nestjs-config]: https://docs.nestjs.com/techniques/configuration
