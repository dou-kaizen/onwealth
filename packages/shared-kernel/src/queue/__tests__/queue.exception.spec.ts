import { describe, expect, it } from 'vitest'
import { QueueException } from '../queue.exception.js'

describe('QueueException', () => {
  it('defaults isFatal to false', () => {
    const error = new QueueException('job failed')
    expect(error.isFatal).toBe(false)
    expect(error.message).toBe('job failed')
    expect(error.name).toBe('QueueException')
    expect(error).toBeInstanceOf(Error)
  })

  it('sets isFatal=true when passed explicitly', () => {
    const error = new QueueException('unrecoverable', true)
    expect(error.isFatal).toBe(true)
  })

  it('is instanceof QueueException and Error', () => {
    const error = new QueueException('x')
    expect(error).toBeInstanceOf(QueueException)
    expect(error).toBeInstanceOf(Error)
  })
})
