import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import type { BaseAggregateRoot } from '../domain/base-aggregate-root.js'
import type { DomainEvent } from '../domain/events/index.js'

/**
 * Domain event publisher.
 *
 * Semantics:
 * - At-most-once for events whose ALL listeners completed successfully.
 * - The event that triggered the failure is DROPPED (logged at warn level) and
 *   NOT restored to the aggregate. Reason: `emitAsync` awaits all listeners; if
 *   listener A succeeded and listener B threw, restoring the event would re-fire
 *   listener A on retry — silent at-least-once for the failed event.
 * - Events AFTER the failing index are restored to the aggregate so the caller
 *   may retry the publish loop.
 *
 * Listeners MUST be idempotent regardless — partial publishes can also happen
 * if the process crashes between listener invocations.
 *
 * TODO(outbox): true at-least-once / exactly-once requires an outbox pattern.
 * Tracked in `docs/project-roadmap.md`. Do NOT use this publisher inside a
 * transactional boundary that requires guaranteed delivery.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name)

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publishEventsForAggregate(aggregate: BaseAggregateRoot): Promise<void> {
    // `getDomainEvents()` already returns a defensive copy at base-aggregate-root.ts:6.
    // Snapshot then clear so a partial failure does not re-publish succeeded events.
    const events = aggregate.getDomainEvents()
    aggregate.clearDomainEvents()
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      if (!event) continue
      try {
        await this.eventEmitter.emitAsync(event.eventName, event)
      } catch (err) {
        // Restore from i+1 onward — events[i] partially published (multi-listener race);
        // re-restoring events[i] would re-fire succeeded listeners on retry.
        const remaining = events.slice(i + 1)
        if (remaining.length > 0) {
          ;(
            aggregate as unknown as { restoreDomainEvents(e: DomainEvent[]): void }
          ).restoreDomainEvents(remaining)
        }
        this.logger.warn('domain event publish failed; dropping failing event', {
          eventName: event.eventName,
          remaining: remaining.length,
        })
        throw err
      }
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.eventEmitter.emitAsync(event.eventName, event)
  }
}
