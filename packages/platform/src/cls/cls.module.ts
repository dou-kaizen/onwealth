import { Module } from '@nestjs/common'
import { ClsModule as NestClsModule } from 'nestjs-cls'

import { createClsConfig } from './cls.config'

/**
 * Foundation CLS module.
 *
 * Mounts request-scoped storage as global middleware so downstream
 * filters/interceptors/loggers can read tracing IDs without prop drilling.
 */
@Module({
  imports: [NestClsModule.forRoot(createClsConfig())],
  exports: [NestClsModule],
})
export class ClsModule {}
