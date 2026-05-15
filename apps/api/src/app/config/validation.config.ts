import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common'

/**
 * Create the global validation pipe configuration
 *
 * Configuration notes:
 * - whitelist: automatically strips properties not declared in the DTO
 * - forbidNonWhitelisted: throws a 422 error if unknown properties are present
 * - transform: automatically converts types (e.g. string → number)
 * - stopAtFirstError: returns all validation errors, not just the first
 * - errorHttpStatusCode: validation errors return 422 (Unprocessable Entity)
 *
 * @returns a configured ValidationPipe instance
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      // Explicit @Type(() => X) decorators must be used for type coercion; implicit
      // coercion runs before whitelist strip which can bypass validation guards.
      enableImplicitConversion: false,
    },
    stopAtFirstError: false,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (errors) => {
      // Custom exception factory to ensure UnprocessableEntityException (422) is thrown
      return new UnprocessableEntityException(errors)
    },
  })
}
