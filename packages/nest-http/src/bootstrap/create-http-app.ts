import type { Type } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { configureHttpApp } from './configure-http-app.js'
import type { HttpAppOptions } from './http-app-options.js'

/**
 * Thin convenience wrapper: create a Nest app from a root module, then apply
 * the shared HTTP configuration via {@link configureHttpApp}.
 *
 * Intended for production entrypoints (`main.ts`) only — it always calls
 * `NestFactory.create`, so it must never be handed a compiled `TestingModule`.
 * Tests create the app from their `TestingModule` and call `configureHttpApp`
 * directly.
 *
 * `bufferLogs: true` defers bootstrap log output until the caller installs a
 * logger via `app.useLogger()`.
 */
export async function createHttpApp(
  module: Type,
  options?: HttpAppOptions,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, {
    bufferLogs: true,
  })
  return configureHttpApp(app, options)
}
