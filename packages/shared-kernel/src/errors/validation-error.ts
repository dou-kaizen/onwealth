/**
 * class-validator validation error type definitions
 */
export interface ValidationErrorItem {
  property: string
  constraints?: Record<string, string>
  /**
   * Per-constraint context injected via { context: { code: '...' } }
   */
  contexts?: Record<string, { code?: string } | undefined>
  children?: ValidationErrorItem[]
}

/**
 * Flat representation of a single validation failure used in RFC 9457 error responses.
 */
export interface FlatValidationError {
  property: string
  message: string
  code?: string
}

/**
 * Recursively flattens a class-validator ValidationError tree into a flat list.
 *
 * Each nested error has its property path prefixed with the parent property
 * (e.g. "address.street") so callers can build JSON Pointer strings.
 *
 * @param errors - Top-level ValidationErrorItem array from class-validator
 * @param prefix - Internal recursion prefix; callers should omit this parameter
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
