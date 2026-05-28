import { configureHttpApp } from '@boilerplate/nest-http'
import type { Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { AppModule } from '@/app.module'

export interface CreateTestAppOptions {
  moduleOverrides?: { original: Type; replacement: Type }[]
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })

  for (const { original, replacement } of options.moduleOverrides ?? []) {
    builder = builder.overrideModule(original).useModule(replacement)
  }

  const moduleFixture = await builder.compile()
  const app = moduleFixture.createNestApplication<NestExpressApplication>()

  // Shared HTTP bootstrap — single source of truth, kept in sync with production.
  await configureHttpApp(app, { testMode: true })

  await app.init()
  return app
}
