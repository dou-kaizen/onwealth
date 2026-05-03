import { Module } from '@nestjs/common'

import { AllExceptionsFilter } from './all-exceptions.filter'
import { ProblemDetailsFilter } from './problem-details.filter'
import { ThrottlerExceptionFilter } from './throttler-exception.filter'

/**
 * Filters module.
 *
 * Registers the three foundation filters as providers so DI can resolve
 * their CLS / Logger / Config dependencies. The actual `useGlobalFilters`
 * binding lives in `apps/api/src/main.ts` (LIFO order: typed → generic).
 */
@Module({
  providers: [ProblemDetailsFilter, AllExceptionsFilter, ThrottlerExceptionFilter],
  exports: [ProblemDetailsFilter, AllExceptionsFilter, ThrottlerExceptionFilter],
})
export class FiltersModule {}
