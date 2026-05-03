import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { describe, expect, it, beforeAll } from 'vitest'

import { HealthController } from './health.controller'

import type { TestingModule } from '@nestjs/testing'

describe('HealthController', () => {
  let controller: HealthController

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()

    controller = moduleRef.get(HealthController)
  })

  it('returns the expected liveness shape', () => {
    const result = controller.check()

    expect(result.status).toBe('ok')
    expect(typeof result.uptime).toBe('number')
    expect(result.uptime).toBeGreaterThanOrEqual(0)
    expect(typeof result.timestamp).toBe('string')
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow()
  })
})
