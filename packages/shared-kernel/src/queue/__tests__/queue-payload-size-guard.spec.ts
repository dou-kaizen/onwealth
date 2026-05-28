import { describe, expect, it } from 'vitest'
import { QueueException } from '../queue.exception.js'
import { assertPayloadSize } from '../queue-payload-size.guard.js'

describe('assertPayloadSize', () => {
  it('accepts payload below default 64 KB cap', () => {
    expect(() => assertPayloadSize({ message: 'short' })).not.toThrow()
  })

  it('throws QueueException on payload exceeding cap', () => {
    const big = { blob: 'x'.repeat(100_000) }
    expect(() => assertPayloadSize(big)).toThrow(QueueException)
  })

  it('respects custom maxBytes', () => {
    expect(() => assertPayloadSize({ a: 'hello' }, 4)).toThrow(QueueException)
  })

  it('throws typed QueueException on circular references (not raw TypeError)', () => {
    const cyclic: Record<string, unknown> = { name: 'cycle' }
    cyclic.self = cyclic
    let caught: unknown
    try {
      assertPayloadSize(cyclic)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(QueueException)
    expect((caught as Error).message).toBe('payload not serializable')
  })

  it('counts multi-byte UTF-8 characters by byte length, not character count', () => {
    // '😀' is 4 bytes in UTF-8 but length 2 in JS string units.
    // 20 emojis = 80 bytes; after JSON.stringify adds quotes/key overhead it is well >50 bytes.
    const payload = { msg: '😀'.repeat(20) }
    expect(() => assertPayloadSize(payload, 50)).toThrow(QueueException)
    expect(() => assertPayloadSize(payload, 200)).not.toThrow()
  })

  it('accepts undefined (JSON.stringify returns undefined)', () => {
    expect(() => assertPayloadSize(undefined)).not.toThrow()
  })

  it('accepts null', () => {
    expect(() => assertPayloadSize(null)).not.toThrow()
  })
})
