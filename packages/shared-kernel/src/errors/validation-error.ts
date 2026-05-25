/**
 * Subset of the class-validator `ValidationError` shape we actually consume.
 *
 * Imported as `unknown`-equivalent at call sites and narrowed via this
 * interface so we don't pull class-validator into every consumer's
 * dependency graph.
 */
export interface ValidationErrorItem {
  property: string
  constraints?: Record<string, string>
  /**
   * Per-constraint metadata injected via `{ context: { code: '...' } }` on
   * the original decorator. Used to attach an {@link ErrorCode} to a
   * specific failed constraint without re-typing the rule.
   */
  contexts?: Record<string, { code?: string } | undefined>
  children?: ValidationErrorItem[]
}

/**
 * Flat representation of a single validation failure, suitable for emission
 * in an RFC 9457 problem-details `errors` array.
 *
 * `property` is the dotted path from the root of the validated DTO; callers
 * can convert to a JSON Pointer for the spec's `pointer` field by replacing
 * `.` with `/`.
 */
export interface FlatValidationError {
  property: string
  message: string
  code?: string
}

/**
 * Recursively flatten a class-validator error tree into a list of
 * {@link FlatValidationError}.
 *
 * Each nested error has its property prefixed with the parent property path
 * (e.g. `address.street`), so callers can build JSON Pointer strings without
 * walking the tree themselves.
 *
 * Pure function — does not mutate input.
 *
 * @param errors Top-level error array from class-validator.
 * @param prefix Internal recursion accumulator; callers should omit it.
 * @returns Flat list of `{ property, message, code? }`.
 */
export function flattenValidationErrors(
  errors: ValidationErrorItem[],
  prefix = '',
): FlatValidationError[] {
  return errors.flatMap((err) => {
    const property = prefix ? `${prefix}.${err.property}` : err.property

    const constraints: FlatValidationError[] = err.constraints
      ? Object.entries(err.constraints).map(([constraintName, message]) => ({
          property,
          message,
          code: err.contexts?.[constraintName]?.code,
        }))
      : []

    const nested: FlatValidationError[] = err.children?.length
      ? flattenValidationErrors(err.children, property)
      : []

    return [...constraints, ...nested]
  })
}
