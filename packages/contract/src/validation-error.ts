/**
 * class-validator ValidationError shape (subset used by filters).
 *
 * Captured in @onwealth/contract so platform filters can typecheck against
 * the shape without depending on class-validator at the contract layer.
 */
export interface ValidationErrorItem {
  property: string
  constraints?: Record<string, string>
  /** Per-constraint context injected via `{ context: { code: '...' } }` */
  contexts?: Record<string, { code?: string } | undefined>
  children?: ValidationErrorItem[]
}
