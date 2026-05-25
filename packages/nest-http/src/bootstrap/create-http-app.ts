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
 * `NestFactory.create`, so it must NEVER be handed a compiled
 * `TestingModule`. Tests create the app from their `TestingModule` and call
 * {@link configureHttpApp} directly.
 *
 * **Key options:**
 * - `bufferLogs: true` — defers bootstrap log output until the caller installs
 *   a logger via `app.useLogger()`. Without this, early logs print through
 *   Nest's default console logger and bypass the pino transport.
 * - `bodyParser: false` — disables NestJS's built-in body parser so the
 *   explicit `express.json({ limit: BODY_LIMIT })` registered in
 *   {@link configureHttpApp} is the SOLE parser. Without this, two body
 *   parsers run in sequence and the larger NestJS-default limit can be hit
 *   before ours fires.
 */
export async function createHttpApp(
  module: Type,
  options?: HttpAppOptions,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(module, {
    bufferLogs: true,
    bodyParser: false,
  })
  return configureHttpApp(app, options)
}
