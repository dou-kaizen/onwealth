import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common'

/**
 * Build the global ValidationPipe.
 *
 * - `whitelist` strips properties not declared in the DTO
 * - `forbidNonWhitelisted` rejects unknown properties (422)
 * - `transform` runs class-transformer (string→number/Date/etc.)
 * - `enableImplicitConversion: false` (intentional). class-transformer
 *   coerces using TS metadata BEFORE class-validator runs; implicit
 *   coercion is a type-smuggling vector ("99999999" → number, NaN,
 *   Infinity all bypass `@IsNumber()`-less DTOs). Every coerced field
 *   MUST use explicit `@Type(() => Number)` / `@Type(() => Boolean)` /
 *   `@Type(() => NestedDto)`.
 * - `stopAtFirstError: false` so the response carries every issue
 * - validation errors map to 422 (Unprocessable Entity) — RFC 9457
 *   Problem Details renders these as `errors[]` field-level entries
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
    stopAtFirstError: false,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (errors) => new UnprocessableEntityException(errors),
  })
}
