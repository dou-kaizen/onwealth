import type { INestApplication } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { createHttpApp, httpConfig } from '@onwealth/nest-http'
import { appConfig } from '@onwealth/shared-kernel'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'

/** Hard-stop fallback in ms — bounded so a stuck `app.close()` cannot wedge the process. */
const SHUTDOWN_GRACE_MS = 5000

/**
 * App reference hoisted out of bootstrap so unhandledRejection / uncaughtException
 * handlers can call `app.close()` for a graceful drain instead of a raw
 * `process.exit(1)` that would drop in-flight requests, abandon BullMQ workers,
 * and leak the Postgres pool. `app.enableShutdownHooks()` is already called
 * inside `configureHttpApp`.
 */
let app: INestApplication | undefined

async function bootstrap() {
  // Shared HTTP bootstrap — filters, interceptors, pipes, CORS, Swagger, etc.
  app = await createHttpApp(AppModule)

  // Use nestjs-pino Logger — flushes the buffered bootstrap logs.
  const logger = app.get(Logger)
  app.useLogger(logger)

  const httpCfg = app.get<ConfigType<typeof httpConfig>>(httpConfig.KEY)
  const appCfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY)

  const port = httpCfg.port
  // Bind to 0.0.0.0 for container environments (Docker, Kubernetes) where
  // localhost-only binding makes the port unreachable from outside the pod.
  await app.listen(port, '0.0.0.0')
  const baseUrl = `http://localhost:${port}`

  const startupMessage = `
┌─────────────────────────────────────────────────────┐
│              NestJS Boilerplate Server              │
├─────────────────────────────────────────────────────┤
│  Environment:  ${appCfg.nodeEnv.padEnd(35)}  │
│  Port:         ${String(port).padEnd(35)}  │
│  Node:         ${process.version.padEnd(35)}  │
├─────────────────────────────────────────────────────┤
│  Endpoints:                                         │
│  - App:        ${baseUrl.padEnd(35)}  │
│  - Docs:       ${`${baseUrl}/docs`.padEnd(35)}  │
│  - Swagger:    ${`${baseUrl}/swagger`.padEnd(35)}  │
│  - YAML:       ${`${baseUrl}/openapi.yaml`.padEnd(35)}  │
│  - Health:     ${`${baseUrl}/health`.padEnd(35)}  │
└─────────────────────────────────────────────────────┘`

  logger.log(startupMessage)
}

/**
 * Graceful shutdown — invoked by fatal-process handlers and bootstrap failure.
 *
 * Order matters:
 *   1. Log via the app's Logger if available (so the entry hits the same
 *      transports as the rest of the app); fall back to console pre-bootstrap.
 *   2. `await app.close()` runs Nest's onModuleDestroy lifecycle, which drains
 *      the HTTP server, closes the Postgres pool, and shuts down BullMQ
 *      workers via `enableShutdownHooks`.
 *   3. Schedule a hard-stop fallback so a hanging `close()` cannot prevent exit.
 *      `unref()` keeps the timer from holding the loop open in the happy path.
 */
async function shutdown(code: number, reason: string, err: unknown): Promise<void> {
  // Use the in-app pino logger if the container booted; otherwise plain console.
  let logger: { error: (...args: unknown[]) => void } = console
  try {
    const piner = app?.get(Logger, { strict: false })
    if (piner) {
      logger = piner
    }
  } catch {
    // pre-bootstrap: container has no Logger yet — keep console fallback.
  }
  logger.error({ reason, err }, 'fatal: shutting down')

  try {
    await app?.close()
  } catch {
    // already in the fatal path — swallow secondary errors and proceed to exit.
  }

  setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS).unref()
}

process.on('unhandledRejection', (reason) => {
  void shutdown(1, 'unhandledRejection', reason)
})
process.on('uncaughtException', (err) => {
  void shutdown(1, 'uncaughtException', err)
})

bootstrap().catch((err: unknown) => {
  void shutdown(1, 'bootstrap', err)
})
