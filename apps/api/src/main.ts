import type { ConfigType } from '@nestjs/config'
import { appConfig } from '@onwealth/shared-kernel'
import { createHttpApp, httpConfig } from '@onwealth/nest-http'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'

async function bootstrap() {
  // Shared HTTP bootstrap — filters, interceptors, pipes, CORS, Swagger, etc.
  const app = await createHttpApp(AppModule)

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

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error:', err)
  process.exit(1)
})
