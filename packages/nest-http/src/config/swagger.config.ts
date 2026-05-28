import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject, SwaggerCustomOptions } from '@nestjs/swagger'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { apiReference } from '@scalar/nestjs-api-reference'
import { ProblemDetailsDto } from '../dtos/problem-details.dto.js'

/** Static metadata embedded in the generated OpenAPI document. */
export const swaggerConfig = {
  title: 'NestJs API',
  description: 'NestJS modular layered architecture example project API documentation',
  version: '1.0',
}

/**
 * Swagger UI custom options.
 *
 * `persistAuthorization: true` keeps the bearer token across page reloads.
 * See the CSP note in `configure-http-app.ts` for the residual XSS risk this
 * introduces and the re-evaluation trigger.
 */
export const swaggerCustomOptions: SwaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: true,
  },
}

/**
 * Inject a generic RFC 9457 Problem Details `default` response into every
 * endpoint missing one.
 *
 * Uses the OpenAPI `default` response feature so any undefined status code
 * (400/401/403/404/422/429/500, …) renders the standard error shape rather
 * than an empty schema. Skips operations that already declare a `default`.
 *
 * Pure mutation of the supplied `document` for ergonomics (mirrors how
 * `SwaggerModule.setup` consumes the doc).
 */
function addDefaultErrorResponses(document: OpenAPIObject): void {
  if (!document.paths) return

  for (const path of Object.keys(document.paths)) {
    const pathItem = document.paths[path]
    if (!pathItem) continue

    for (const method of Object.keys(pathItem ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
        continue
      }

      const operation = pathItem[method as keyof typeof pathItem]
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) {
        continue
      }

      if (operation.responses && !operation.responses.default) {
        operation.responses.default = {
          description: 'Error response (includes 400/401/403/404/422/429/500, etc.)',
          content: {
            'application/problem+json': {
              schema: {
                $ref: '#/components/schemas/ProblemDetailsDto',
              },
            },
          },
        }
      }
    }
  }
}

/**
 * Mount API documentation routes:
 * - `GET /docs` — Scalar API Reference (richer UI, default-facing route).
 * - `GET /swagger` — classic Swagger UI fallback.
 * - `GET /openapi.yaml` — YAML mirror of the JSON document (exposed by
 *   Swagger via `yamlDocumentUrl`).
 *
 * `deepScanRoutes: true` with an empty `include` makes `SwaggerModule` walk
 * EVERY registered module instead of filtering against an allowlist.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle(swaggerConfig.title)
    .setDescription(swaggerConfig.description)
    .setVersion(swaggerConfig.version)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer('http://localhost:3000', 'Development')
    .addTag('health', 'Health check endpoints')
    .addTag('auth', 'Authentication endpoints')
    .addTag('todos', 'Todo management endpoints')
    .addTag('articles', 'Article management endpoints')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config, {
    include: [],
    deepScanRoutes: true,
    extraModels: [ProblemDetailsDto],
    operationIdFactory: (controllerKey: string, methodKey: string) =>
      `${controllerKey}_${methodKey}`,
  })

  addDefaultErrorResponses(document)

  SwaggerModule.setup('swagger', app, document, {
    ...swaggerCustomOptions,
    yamlDocumentUrl: '/openapi.yaml',
  })

  app.use(
    '/docs',
    apiReference({
      content: document,
    }),
  )
}
