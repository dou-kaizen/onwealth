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
 * hard-coded here — keeps the logger transport/route-agnostic so it can be
 * reused by non-HTTP NestJS apps (e.g. a worker) without dragging in HTTP
 * route definitions.
 */
export interface LoggerConfigOptions {
  /**
   * High-frequency probe routes excluded from access logs (e.g. health
   * checks). Accepts the nestjs-pino `exclude` shape (`string | RouteInfo`).
   */
  excludePaths?: Params['exclude']

  /**
   * URL prefix allowlist for pino-http `autoLogging.ignore`.
   *
   * Requests whose URL does NOT start with this prefix are suppressed from
   * access logs — useful to silence non-API traffic (static assets,
   * container probes) while keeping `/api/` request logs intact.
   *
   * Defaults to `'/api/'` when omitted so callers that don't care get
   * standard HTTP-API behaviour with zero config.
   */
  autoLoggingUrlPrefix?: string
}

/**
 * Build the nestjs-pino module config consumed by {@link LoggerModule}.
 *
 * **Highlights:**
 * - Log level derived from `NODE_ENV` via {@link getLogLevel}.
 * - Sensitive field redaction wired to {@link redactPaths} /
 *   {@link redactCensor}.
 * - `customProps` extracts tracing IDs from headers and feeds them through
 *   {@link sanitizeHeaderValue} to close log-injection (CR/LF/TAB/NUL/ANSI
 *   stripping). traceparent is parsed via {@link extractTraceId} with the
 *   same W3C validity checks as `parseTraceparent` in `trace-context.util`.
 * - In non-prod, output goes through `pino-pretty` for human readability;
 *   production stays JSON for ingestion pipelines.
 *
 * @param config NestJS `ConfigService` typed against {@link Env}.
 * @param options Route-agnostic logger overrides — see {@link LoggerConfigOptions}.
 * @returns nestjs-pino module configuration.
 */
export function createLoggerConfig(
  config: ConfigService<Env, true>,
  options: LoggerConfigOptions = {},
): Params {
  const nodeEnv: 'development' | 'production' | 'test' = config.get('NODE_ENV')
  const isProduction = nodeEnv === 'production'
  const logLevel = getLogLevel(nodeEnv)

  const autoLoggingUrlPrefix = options.autoLoggingUrlPrefix ?? '/api/'

  return {
    pinoHttp: {
      level: logLevel,

      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? ''
          return !url.startsWith(autoLoggingUrlPrefix)
        },
      },

      redact: {
        paths: redactPaths,
        censor: redactCensor,
      },

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

      customProps: (req: IncomingMessage) => ({
        correlationId: sanitizeHeaderValue(req.headers['x-correlation-id']),
        requestId: sanitizeHeaderValue(req.headers['x-request-id']),
        traceId: extractTraceId(req.headers.traceparent as string | undefined),
      }),

      customSuccessMessage: (req: IncomingMessage, res: ServerResponse) => {
        return `${req.method} ${req.url} ${res.statusCode}`
      },

      customErrorMessage: (req: IncomingMessage, res: ServerResponse, error: Error) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${error.message}`
      },

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
 * Map `NODE_ENV` to a pino log level.
 *
 * - `production` → `info` (operational signal only).
 * - `test`       → `warn` (suppress test-run noise).
 * - `development` → `debug` (full visibility while iterating).
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
 * Extract the trace-id segment from a W3C Trace Context `traceparent` header.
 *
 * `traceparent` format: `version-trace_id-parent_id-trace_flags`
 * (e.g. `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`).
 *
 * Mirrors the W3C validity checks applied by `parseTraceparent` in
 * `trace-context.util.ts` (kept duplicated here to avoid a cross-package
 * import cycle):
 * - 4 dash-separated segments of correct hex length.
 * - `version === 'ff'` is reserved → reject.
 * - All-zero `trace_id` means "no active trace" → reject.
 *
 * @returns the lowercase hex trace-id, or `undefined` if invalid/missing.
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

  if (
    version?.length !== 2 ||
    traceId?.length !== 32 ||
    !/^[0-9a-f]+$/i.test(version) ||
    !/^[0-9a-f]+$/i.test(traceId)
  ) {
    return undefined
  }

  if (version === 'ff' || traceId === '0'.repeat(32)) {
    return undefined
  }

  return traceId
}
