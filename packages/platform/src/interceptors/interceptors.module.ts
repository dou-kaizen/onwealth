import { Module } from '@nestjs/common'

import { TimeoutInterceptor } from './timeout.interceptor'
import { TransformInterceptor } from './transform.interceptor'

/**
 * Interceptors module.
 *
 * Registers the foundation interceptors as providers (DI-resolved
 * Reflector + ClsService + ConfigService). Global binding happens in
 * `apps/api/main.ts`.
 */
@Module({
  providers: [TransformInterceptor, TimeoutInterceptor],
  exports: [TransformInterceptor, TimeoutInterceptor],
})
export class InterceptorsModule {}
