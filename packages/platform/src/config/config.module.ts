import { Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule } from '@nestjs/config'

import { validateEnv } from './env.schema'

/**
 * Global ConfigModule with Zod-validated env.
 *
 * `validate` runs at module init; failure crashes bootstrap so missing or
 * malformed env never reaches request handling.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
