import { RequestMethod } from '@nestjs/common'

import { redactCensor, redactPaths } from './redaction.config'

import type { Env } from '../config/env.schema'
import type { ConfigService } from '@nestjs/config'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Params } from 'nestjs-pino'

/**
 * Build nestjs-pino params from env.
 *
 * - JSON output in production; pino-pretty single-line in dev/test
 * - allowlist autoLogging: only `/api/*` paths emit per-request logs
 * - health-check routes excluded entirely (high frequency, low signal)
 * - traceId/correlationId injected as customProps so they appear on every line
 */
export function createLoggerConfig(config: ConfigService<Env, true>): Params {
  const nodeEnv: 'development' | 'production' | 'test' = config.get('NODE_ENV')
  const isProduction = nodeEnv === 'production'
  const logLevel = getLogLevel(nodeEnv)

  return {
    pinoHttp: {
      level: logLevel,

      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? ''
          return !url.startsWith('/api/')
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
        correlationId: req.headers['x-correlation-id'],
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

    exclude: [
      { method: RequestMethod.GET, path: 'health' },
      { method: RequestMethod.GET, path: 'health/live' },
      { method: RequestMethod.GET, path: 'health/ready' },
    ],
  }
}

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
 * Extract trace-id (second segment) from a W3C traceparent header.
 *
 * Format: `version-trace_id-parent_id-trace_flags`
 */
function extractTraceId(traceparent: string | undefined): string | undefined {
  if (!traceparent) {
    return undefined
  }
  const parts = traceparent.split('-')
  return parts[1]
}
