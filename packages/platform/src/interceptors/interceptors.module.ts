import { Module } from '@nestjs/common'

import { TransformInterceptor } from './transform.interceptor'

/**
 * Interceptors module.
 *
 * Registers the foundation interceptors as providers (DI-resolved
 * Reflector + ClsService). Global binding happens in `apps/api/main.ts`.
 */
@Module({
  providers: [TransformInterceptor],
  exports: [TransformInterceptor],
})
export class InterceptorsModule {}
