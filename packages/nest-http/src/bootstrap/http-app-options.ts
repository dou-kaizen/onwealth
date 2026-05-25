/**
 * Options for {@link configureHttpApp} / {@link createHttpApp}.
 */
export interface HttpAppOptions {
  /**
   * When `true`:
   * - Swagger setup is skipped (avoids polluting test output with schema
   *   gen + endpoint mounting).
   * - CORS uses a fixed permissive origin (`http://localhost:3000`) for
   *   deterministic, isolated test requests.
   *
   * Production bootstrap leaves this unset so CORS origins are read from
   * `httpConfig` and Swagger gating defers to `NODE_ENV`.
   */
  testMode?: boolean
}
