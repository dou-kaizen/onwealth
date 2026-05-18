import { ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { describe, expect, it, vi } from 'vitest'
import type { DrizzleHealthIndicator } from '../drizzle.health.js'
import { HealthController } from '../health.controller.js'
import type { RedisHealthIndicator } from '../redis.health.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDrizzle(status: 'up' | 'down') {
  return {
    isHealthy: vi.fn().mockResolvedValue({
      database: {
        status,
        message: status === 'up' ? 'Database is available' : 'Connection failed',
      },
    }),
  } as unknown as DrizzleHealthIndicator
}

function makeRedis(status: 'up' | 'down') {
  return {
    isHealthy: vi.fn().mockResolvedValue({
      redis: { status, message: status === 'up' ? 'Redis is available' : 'Connection failed' },
    }),
  } as unknown as RedisHealthIndicator
}

function makeMemory() {
  return {
    checkHeap: vi.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
    checkRSS: vi.fn().mockResolvedValue({ memory_rss: { status: 'up' } }),
  } as unknown as MemoryHealthIndicator
}

function makeDisk() {
  return {
    checkStorage: vi.fn().mockResolvedValue({ storage: { status: 'up' } }),
  } as unknown as DiskHealthIndicator
}

function makeConfig() {
  return {
    get: vi.fn().mockReturnValue('test'),
    // Cast via unknown to satisfy ConfigService<Env, true> — safe in test context
  } as unknown as ConfigService<Record<string, unknown>, true>
}

// Build a HealthCheckService that returns an up result from the given checks array.
function makePassingService() {
  return {
    check: vi
      .fn()
      .mockImplementation(async (checks: Array<() => Promise<Record<string, unknown>>>) => {
        const details: Record<string, unknown> = {}
        for (const check of checks) {
          const result = await check()
          Object.assign(details, result)
        }
        return { status: 'ok', details }
      }),
  } as unknown as HealthCheckService
}

// Build a HealthCheckService that throws ServiceUnavailableException (terminus behavior on down).
function makeFailingService() {
  return {
    check: vi.fn().mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        error: { database: { status: 'down', message: 'Connection failed' } },
      }),
    ),
  } as unknown as HealthCheckService
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthController', () => {
  describe('GET /livez', () => {
    it('returns shaped response when memory check passes', async () => {
      const health = makePassingService()
      const controller = new HealthController(
        health,
        makeDrizzle('up'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      const result = await controller.liveness()

      expect(result).toMatchObject({ environment: 'test' })
      expect(health.check).toHaveBeenCalledTimes(1)
    })

    it('throws ServiceUnavailableException with static message when memory check fails', async () => {
      const controller = new HealthController(
        makeFailingService(),
        makeDrizzle('up'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      await expect(controller.liveness()).rejects.toBeInstanceOf(ServiceUnavailableException)
      await expect(controller.liveness()).rejects.toThrow('One or more components unhealthy')
    })

    it('down response body never contains raw infra error strings', async () => {
      const controller = new HealthController(
        makeFailingService(),
        makeDrizzle('down'),
        makeRedis('down'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      try {
        await controller.liveness()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException)
        const bodyStr = JSON.stringify((err as ServiceUnavailableException).getResponse())
        // Must not contain raw connection strings, hostnames, or pg error messages
        expect(bodyStr).not.toContain('ECONNREFUSED')
        expect(bodyStr).not.toContain('password')
        expect(bodyStr).not.toContain('5432')
      }
    })
  })

  describe('GET /readyz', () => {
    it('returns shaped response when DB + Redis are up', async () => {
      const controller = new HealthController(
        makePassingService(),
        makeDrizzle('up'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      const result = await controller.readiness()

      expect(result).toMatchObject({ environment: 'test' })
    })

    it('throws with static message when DB is down', async () => {
      const controller = new HealthController(
        makeFailingService(),
        makeDrizzle('down'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      await expect(controller.readiness()).rejects.toThrow('One or more components unhealthy')
    })

    it('throws with static message when Redis is down', async () => {
      const controller = new HealthController(
        makeFailingService(),
        makeDrizzle('up'),
        makeRedis('down'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      await expect(controller.readiness()).rejects.toThrow('One or more components unhealthy')
    })
  })

  describe('GET /health (detailed)', () => {
    it('returns shaped response when all components are up', async () => {
      const controller = new HealthController(
        makePassingService(),
        makeDrizzle('up'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      const result = await controller.detailed()

      expect(result).toMatchObject({ environment: 'test' })
    })

    it('throws ServiceUnavailableException with STATIC string — no per-component leak', async () => {
      const controller = new HealthController(
        makeFailingService(),
        makeDrizzle('down'),
        makeRedis('down'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      try {
        await controller.detailed()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException)
        // Static message — must not concatenate per-component raw messages
        const response = (err as ServiceUnavailableException).getResponse() as {
          message: string
        }
        expect(response.message).toBe('One or more components unhealthy')
      }
    })

    it('re-throws non-ServiceUnavailableException errors unchanged', async () => {
      const health = {
        check: vi.fn().mockRejectedValue(new Error('Unexpected internal error')),
      } as unknown as HealthCheckService
      const controller = new HealthController(
        health,
        makeDrizzle('up'),
        makeRedis('up'),
        makeMemory(),
        makeDisk(),
        makeConfig(),
      )

      await expect(controller.detailed()).rejects.toThrow('Unexpected internal error')
    })
  })
})
