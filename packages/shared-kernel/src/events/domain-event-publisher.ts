import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import type { BaseAggregateRoot } from '../domain/base-aggregate-root.js'
import type { DomainEvent } from '../domain/events/index.js'

/**
 * Domain event publisher
 *
 * Responsible for collecting events from aggregate roots and publishing them to the event bus.
 */
@Injectable()
export class DomainEventPublisher {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publishEventsForAggregate(aggregate: BaseAggregateRoot): Promise<void> {
    const events = aggregate.getDomainEvents()
    // at-most-once semantics: clear before publish so partial failure does not re-publish
    // succeeded events on the next call. Re-evaluate if outbox/retry pattern is introduced.
    aggregate.clearDomainEvents()
    for (const event of events) {
      await this.publish(event)
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.eventEmitter.emitAsync(event.eventName, event)
  }
}
