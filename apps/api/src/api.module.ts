import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard } from '@nestjs/throttler'
import { ClsModule } from '@onwealth/platform/cls'
import { ConfigModule } from '@onwealth/platform/config'
import { DatabaseModule } from '@onwealth/platform/database'
import { FiltersModule } from '@onwealth/platform/filters'
import { InterceptorsModule } from '@onwealth/platform/interceptors'
import { LoggerModule } from '@onwealth/platform/logger'
import { ThrottlerModule } from '@onwealth/platform/throttler'

import { HealthModule } from './health/health.module'

/**
 * Root composition.
 *
 * Foundation modules from `@onwealth/platform/*` are imported here so the
 * full middleware chain (config → cls → logger → db → throttler → filters →
 * interceptors) is wired before any feature module mounts. `ThrottlerGuard`
 * is bound globally via `APP_GUARD` so every route gets rate-limited unless
 * a feature opts out with `@SkipThrottle()`.
 */
@Module({
  imports: [
    ConfigModule,
    ClsModule,
    LoggerModule,
    DatabaseModule.forRoot(),
    ThrottlerModule,
    FiltersModule,
    InterceptorsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ApiModule {}
