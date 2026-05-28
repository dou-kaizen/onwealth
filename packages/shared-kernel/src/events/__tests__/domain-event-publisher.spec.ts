import { EventEmitter2 } from '@nestjs/event-emitter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseAggregateRoot } from '../../domain/base-aggregate-root.js'
import { DomainEvent } from '../../domain/events/domain-event.base.js'
import { DomainEventPublisher } from '../domain-event-publisher.js'

class FirstEvent extends DomainEvent {}
class SecondEvent extends DomainEvent {}
class ThirdEvent extends DomainEvent {}

class TestAggregate extends BaseAggregateRoot {
  raise(event: DomainEvent): void {
    // `addDomainEvent` is protected — promote it for the test harness.
    this.addDomainEvent(event)
  }
}

describe('DomainEventPublisher', () => {
  let emitter: EventEmitter2
  let publisher: DomainEventPublisher

  beforeEach(() => {
    emitter = new EventEmitter2()
    publisher = new DomainEventPublisher(emitter)
  })

  it('happy path: emits all events in order and clears the aggregate', async () => {
    const aggregate = new TestAggregate()
    const e1 = new FirstEvent()
    const e2 = new SecondEvent()
    const e3 = new ThirdEvent()
    aggregate.raise(e1)
    aggregate.raise(e2)
    aggregate.raise(e3)

    const emitSpy = vi.spyOn(emitter, 'emitAsync').mockResolvedValue([])

    await publisher.publishEventsForAggregate(aggregate)

    expect(emitSpy).toHaveBeenCalledTimes(3)
    expect(emitSpy).toHaveBeenNthCalledWith(1, 'FirstEvent', e1)
    expect(emitSpy).toHaveBeenNthCalledWith(2, 'SecondEvent', e2)
    expect(emitSpy).toHaveBeenNthCalledWith(3, 'ThirdEvent', e3)
    expect(aggregate.getDomainEvents()).toEqual([])
  })

  it('partial failure: emits first event, restores remaining (failing event dropped), re-throws', async () => {
    const aggregate = new TestAggregate()
    const e1 = new FirstEvent()
    const e2 = new SecondEvent()
    const e3 = new ThirdEvent()
    aggregate.raise(e1)
    aggregate.raise(e2)
    aggregate.raise(e3)

    // Succeed on e1, throw on e2 — e3 is never attempted.
    const emitSpy = vi
      .spyOn(emitter, 'emitAsync')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('listener exploded'))

    await expect(publisher.publishEventsForAggregate(aggregate)).rejects.toThrow(
      'listener exploded',
    )

    expect(emitSpy).toHaveBeenCalledTimes(2)
    // The failing event (e2) is DROPPED — re-restoring it would re-fire e1's
    // listeners on a retry (multi-listener `emitAsync` race). Only e3 (untouched)
    // is restored to the aggregate for the caller's retry loop.
    const remaining = aggregate.getDomainEvents()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toBe(e3)
  })

  it('throw on the LAST event: nothing remains to restore', async () => {
    const aggregate = new TestAggregate()
    const e1 = new FirstEvent()
    aggregate.raise(e1)

    vi.spyOn(emitter, 'emitAsync').mockRejectedValueOnce(new Error('boom'))

    await expect(publisher.publishEventsForAggregate(aggregate)).rejects.toThrow('boom')
    expect(aggregate.getDomainEvents()).toEqual([])
  })

  it('empty aggregate: no emitter call, no throw', async () => {
    const aggregate = new TestAggregate()
    const emitSpy = vi.spyOn(emitter, 'emitAsync')

    await expect(publisher.publishEventsForAggregate(aggregate)).resolves.toBeUndefined()
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('publish(event): one-shot emit bypasses the aggregate flow', async () => {
    const e1 = new FirstEvent()
    const emitSpy = vi.spyOn(emitter, 'emitAsync').mockResolvedValue([])

    await publisher.publish(e1)

    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith('FirstEvent', e1)
  })
})
