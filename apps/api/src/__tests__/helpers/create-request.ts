import type { INestApplication } from '@nestjs/common'
import type { Agent } from 'supertest'
import request from 'supertest'

export function createRequest(app: INestApplication): Agent {
  return request(app.getHttpServer() as never)
}
