import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import type { BaseAggregateRoot } from '../domain/base-aggregate-root.js'
import type { DomainEvent } from '../domain/events/index.js'

/**
 * In-process domain event publisher backed by EventEmitter2.
 *
 * **Delivery semantics:**
 * - **At-most-once** for events whose ALL listeners completed successfully.
 * - The event that triggered the failure is DROPPED (logged at `warn`) and
 *   NOT restored to the aggregate. Reason: `emitAsync` awaits all listeners
 *   in parallel; if listener A succeeded and listener B threw, restoring
 *   the event would re-fire listener A on retry — silent at-least-once for
 *   the failing event.
 * - Events AFTER the failing index ARE restored to the aggregate so the
 *   caller may retry the publish loop with a fresh batch.
 *
 * **Listener contract:** listeners MUST be idempotent regardless — partial
 * publishes also happen if the process crashes between listener invocations.
 *
 * **TODO(outbox):** true at-least-once / exactly-once requires an outbox
 * pattern. Tracked in `docs/project-roadmap.md`. Do NOT use this publisher
 * inside a transactional boundary that requires guaranteed delivery.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name)

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Drain an aggregate's pending events, emitting each in order.
   *
   * Snapshots `getDomainEvents()` then `clearDomainEvents()` BEFORE
   * iterating, so a partial failure does not re-publish events that
   * already succeeded.
   *
   * On listener failure:
   * 1. The failing event is dropped (logged + warning).
   * 2. Events at index `i+1..end` are restored via the protected
   *    {@link BaseAggregateRoot.restoreDomainEvents} crossing — see that
   *    class's JSDoc for the visibility-cast rationale.
   * 3. The original error is rethrown so the caller can decide whether to
   *    retry, transaction-rollback, or surface the failure.
   *
   * @throws Rethrows any listener error after restoring the unsent tail.
   */
  async publishEventsForAggregate(aggregate: BaseAggregateRoot): Promise<void> {
    const events = aggregate.getDomainEvents()
    aggregate.clearDomainEvents()
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      if (!event) continue
      try {
        await this.eventEmitter.emitAsync(event.eventName, event)
      } catch (err) {
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

  /**
   * Emit a single ad-hoc event outside the aggregate lifecycle.
   *
   * Use sparingly; the aggregate-bound {@link publishEventsForAggregate}
   * preserves ordering + retry semantics that this helper does not.
   */
  async publish(event: DomainEvent): Promise<void> {
    await this.eventEmitter.emitAsync(event.eventName, event)
  }
}
