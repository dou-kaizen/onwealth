/**
 * class-validator ValidationError shape (subset used by filters).
 *
 * Filters typecheck against this shape without importing class-validator
 * directly — keeps the runtime dep encapsulated to consumers that need it.
 */
export interface ValidationErrorItem {
  property: string
  constraints?: Record<string, string>
  /** Per-constraint context injected via `{ context: { code: '...' } }` */
  contexts?: Record<string, { code?: string } | undefined>
  children?: ValidationErrorItem[]
}
