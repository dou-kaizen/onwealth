import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'

import { ApiModule } from './api.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiModule)
  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}

void bootstrap()
