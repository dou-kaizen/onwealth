import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConfigService } from '@nestjs/config'
import type { Params } from 'nestjs-pino'
import type { Env } from '../config/env.schema.js'
import { sanitizeHeaderValue } from '../utils/sanitize-header-value.js'
import { redactCensor, redactPaths } from './redaction.config.js'

/**
 * Options for {@link createLoggerConfig}.
 *
 * The route exclusion list is supplied by the consuming app rather than
 * hard-coded here — this keeps the logger transport/route-agnostic so it can
 * be reused by non-HTTP NestJS apps (e.g. a worker) without dragging in HTTP
 * route definitions.
 */
export interface LoggerConfigOptions {
  /**
   * High-frequency probe routes excluded from access logs (e.g. health checks).
   * Accepts the nestjs-pino `exclude` shape (`string | RouteInfo`).
   */
  excludePaths?: Params['exclude']

  /**
   * URL prefix allowlist for pino-http `autoLogging.ignore`.
   * Requests whose URL does NOT start with this prefix are suppressed from
   * access logs — useful to silence non-API traffic (e.g. static assets,
   * container probe paths) while keeping `/api/` request logs intact.
   *
   * Defaults to `'/api/'` when omitted so callers that don't care get the
   * standard HTTP-API behaviour without configuration.
   */
  autoLoggingUrlPrefix?: string
}

/**
 * Create nestjs-pino configuration
 *
 * @param config  - NestJS ConfigService
 * @param options - Route-agnostic logger options (see {@link LoggerConfigOptions})
 * @returns nestjs-pino module configuration
 */
export function createLoggerConfig(
  config: ConfigService<Env, true>,
  options: LoggerConfigOptions = {},
): Params {
  const nodeEnv: 'development' | 'production' | 'test' = config.get('NODE_ENV')
  const isProduction = nodeEnv === 'production'
  const logLevel = getLogLevel(nodeEnv)

  // Allow prefix for auto-logging: requests not matching this prefix are suppressed.
  // Defaults to '/api/' so plain HTTP apps get useful access logs with no config.
  const autoLoggingUrlPrefix = options.autoLoggingUrlPrefix ?? '/api/'

  return {
    pinoHttp: {
      // Log level
      level: logLevel,

      // Suppress access logs for requests outside the API prefix (e.g. container
      // probes, static assets) to reduce log noise in high-frequency environments.
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? ''
          return !url.startsWith(autoLoggingUrlPrefix)
        },
      },

      // Sensitive field redaction
      redact: {
        paths: redactPaths,
        censor: redactCensor,
      },

      // Serializers: control which fields are included in log output
      serializers: {
        req: (req: IncomingMessage & { id?: string; query?: unknown; params?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          query: req.query,
          params: req.params,
          remoteAddress: req.socket?.remoteAddress,
          remotePort: req.socket?.remotePort,
        }),
        res: (res: ServerResponse) => ({
          statusCode: res.statusCode,
        }),
        err: (error: Error) => ({
          type: error.constructor.name,
          message: error.message,
          stack: error.stack,
        }),
      },

      // Custom log properties: extract tracing info from the request.
      // [Phase 2 H2] sanitize attacker-controlled header values before they reach
      // structured logs — strip CR/LF/TAB/NUL/ANSI to close log-injection.
      customProps: (req: IncomingMessage) => ({
        correlationId: sanitizeHeaderValue(req.headers['x-correlation-id']),
        requestId: sanitizeHeaderValue(req.headers['x-request-id']),
        traceId: extractTraceId(req.headers.traceparent as string | undefined),
      }),

      // Custom log messages
      customSuccessMessage: (req: IncomingMessage, res: ServerResponse) => {
        return `${req.method} ${req.url} ${res.statusCode}`
      },

      customErrorMessage: (req: IncomingMessage, res: ServerResponse, error: Error) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${error.message}`
      },

      // Use pino-pretty for human-readable output in development
      ...(isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
                messageFormat: '{context} | {msg}',
              },
            },
          }),
    },

    exclude: options.excludePaths ?? [],
  }
}

/**
 * Get the log level for the given environment
 */
function getLogLevel(nodeEnv: 'development' | 'production' | 'test'): string {
  switch (nodeEnv) {
    case 'production': {
      return 'info'
    }
    case 'test': {
      return 'warn'
    }
    case 'development': {
      return 'debug'
    }
  }
}

/**
 * Extract trace-id from the W3C Trace Context traceparent header.
 *
 * traceparent format: version-trace_id-parent_id-trace_flags
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 *
 * Applies the same W3C validity checks as parseTraceparent in trace-context.util.ts:
 * - version 'ff' is reserved
 * - all-zero trace-id is invalid (no active trace)
 * - header must have 4 dash-separated segments of correct hex length
 */
function extractTraceId(traceparent: string | undefined): string | undefined {
  if (!traceparent) {
    return undefined
  }

  const parts = traceparent.split('-')
  if (parts.length !== 4) {
    return undefined
  }

  const [version, traceId] = parts

  // Basic structural and hex validation
  if (
    version?.length !== 2 ||
    traceId?.length !== 32 ||
    !/^[0-9a-f]+$/i.test(version) ||
    !/^[0-9a-f]+$/i.test(traceId)
  ) {
    return undefined
  }

  // W3C §3.2.2 reserved / invalid sentinel values
  if (version === 'ff' || traceId === '0'.repeat(32)) {
    return undefined
  }

  return traceId
}
