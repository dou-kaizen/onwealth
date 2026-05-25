import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common'

/**
 * Build the global {@link ValidationPipe} consumed by `app.useGlobalPipes`.
 *
 * **Configuration choices and rationale:**
 * - `whitelist: true` — strips properties not declared in the DTO. Defends
 *   against mass-assignment when consumers add fields without re-declaring
 *   their DTOs.
 * - `forbidNonWhitelisted: true` — 422 on unknown properties instead of
 *   silently dropping them, so clients learn their typo immediately.
 * - `transform: true` with `enableImplicitConversion: false` — explicit
 *   `@Type(() => X)` decorators are REQUIRED for coercion. Implicit
 *   conversion runs BEFORE the whitelist strip, which can bypass validation
 *   guards on numeric/boolean fields.
 * - `stopAtFirstError: false` — return ALL validation errors per field so
 *   forms can render every failure at once.
 * - `errorHttpStatusCode: 422` — RFC-aligned (Unprocessable Entity for
 *   semantic failure; 400 stays reserved for syntactic/parse errors).
 * - `exceptionFactory` — explicit `UnprocessableEntityException` ensures
 *   the 422 status sticks even when downstream filters re-wrap.
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
    exceptionFactory: (errors) => {
      return new UnprocessableEntityException(errors)
    },
  })
}
