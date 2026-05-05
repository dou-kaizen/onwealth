import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ProblemDetailsDto } from '@onwealth/platform/problem-details'
import { apiReference } from '@scalar/nestjs-api-reference'

import type { INestApplication } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { OpenAPIObject, SwaggerCustomOptions } from '@nestjs/swagger'
import type { Env } from '@onwealth/platform/config'

/**
 * Swagger base configuration
 */
export const swaggerConfig = {
  title: 'Onwealth API',
  description: 'Onwealth backend API documentation',
  version: '1.0',
}

/**
 * Swagger UI custom configuration options
 */
export const swaggerCustomOptions: SwaggerCustomOptions = {
  swaggerOptions: {
    // Disabled: shared staging browsers expose every user's JWT via
    // localStorage. Operators MUST re-authenticate per session.
    persistAuthorization: false,
  },
}

/**
 * Inject a `default` response on every operation referencing
 * `ProblemDetailsDto`. Lets FE codegen emit ONE error type instead of
 * N status-keyed branches (RFC 9457 spec — single error envelope).
 */
function addDefaultErrorResponses(document: OpenAPIObject): void {
  if (!document.paths) return

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const

  for (const path of Object.keys(document.paths)) {
    const pathItem = document.paths[path]
    if (!pathItem) continue

    for (const method of httpMethods) {
      const operation = pathItem[method]
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
 * Set up API documentation
 *
 * - /docs           Scalar API Reference (default UI)
 * - /swagger        Swagger UI (fallback)
 * - /swagger-json   OpenAPI JSON (codegen)
 * - /openapi.yaml   OpenAPI YAML (codegen pipeline)
 *
 * Server URL pulled from `API_BASE_URL` env so codegen tools (orval,
 * openapi-typescript) generate clients with the correct base regardless
 * of which environment serves the spec.
 */
export function setupSwagger(
  app: INestApplication,
  configService: ConfigService<Env, true>,
): void {
  const apiBaseUrl = configService.get('API_BASE_URL', { infer: true })
  const nodeEnv = configService.get('NODE_ENV', { infer: true })

  const config = new DocumentBuilder()
    .setTitle(swaggerConfig.title)
    .setDescription(swaggerConfig.description)
    .setVersion(swaggerConfig.version)
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(apiBaseUrl, nodeEnv)
    .addTag('health', 'Health check endpoints')
    .addBearerAuth()
    .build()

  const document = SwaggerModule.createDocument(app, config, {
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
