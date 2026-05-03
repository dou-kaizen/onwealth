import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common'

/**
 * Build the global ValidationPipe.
 *
 * - `whitelist` strips properties not declared in the DTO
 * - `forbidNonWhitelisted` rejects unknown properties (422)
 * - `transform` runs class-transformer (string→number/Date/etc.)
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
      enableImplicitConversion: true,
    },
    stopAtFirstError: false,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (errors) => new UnprocessableEntityException(errors),
  })
}
