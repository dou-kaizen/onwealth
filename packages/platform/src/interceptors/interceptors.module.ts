import { Module } from '@nestjs/common'

import { CorrelationIdInterceptor } from './correlation-id.interceptor'
import { RequestContextInterceptor } from './request-context.interceptor'
import { TimeoutInterceptor } from './timeout.interceptor'
import { TraceContextInterceptor } from './trace-context.interceptor'
import { TransformInterceptor } from './transform.interceptor'

/**
 * Interceptors module.
 *
 * Registers the foundation interceptors as providers (DI-resolved
 * Reflector + ClsService + ConfigService). Global binding happens in
 * `apps/api/main.ts` via `app.get(...)` + `useGlobalInterceptors(...)`.
 */
@Module({
  providers: [
    TransformInterceptor,
    TimeoutInterceptor,
    RequestContextInterceptor,
    CorrelationIdInterceptor,
    TraceContextInterceptor,
  ],
  exports: [
    TransformInterceptor,
    TimeoutInterceptor,
    RequestContextInterceptor,
    CorrelationIdInterceptor,
    TraceContextInterceptor,
  ],
})
export class InterceptorsModule {}
