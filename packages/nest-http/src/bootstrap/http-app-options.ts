/**
 * Options for {@link configureHttpApp} / {@link createHttpApp}.
 */
export interface HttpAppOptions {
  /**
   * When true: skip Swagger setup and use a permissive, fixed CORS origin
   * (`http://localhost:3000`) for test isolation. Production bootstrap leaves
   * this unset so CORS origins are read from `httpConfig`.
   */
  testMode?: boolean
}
