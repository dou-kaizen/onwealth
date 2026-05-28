import type { DomainEvent } from './events/domain-event.base.js'

/**
 * Base class for DDD aggregate roots.
 *
 * Owns a private list of pending {@link DomainEvent}s that the aggregate
 * accumulated during command handling. The list is published by
 * {@link DomainEventPublisher} once the transactional boundary commits, then
 * cleared.
 *
 * The events list is stored in a `#` private field (true ECMAScript privacy,
 * not TypeScript `private`) so that no external code — including tests — can
 * accidentally bypass {@link addDomainEvent}.
 */
export abstract class BaseAggregateRoot {
  #domainEvents: DomainEvent[] = []

  /**
   * @returns a defensive copy of the current pending events. Callers may
   *          freely iterate without mutating internal state.
   */
  getDomainEvents(): DomainEvent[] {
    return [...this.#domainEvents]
  }

  /**
   * Append a domain event to the pending list. Call from inside domain
   * methods immediately after the state change that produced the event.
   */
  protected addDomainEvent(event: DomainEvent): void {
    this.#domainEvents.push(event)
  }

  /**
   * Clear the pending list. Called by {@link DomainEventPublisher} BEFORE
   * iterating, so a partial publish failure does not republish events that
   * already succeeded.
   */
  clearDomainEvents(): void {
    this.#domainEvents = []
  }

  /**
   * Re-attach previously-detached events to the aggregate.
   *
   * Used by {@link DomainEventPublisher} to put back events whose publish
   * loop was aborted before they were emitted. NOT for general callers —
   * emitting code should call {@link addDomainEvent} via the domain method
   * that produced the event.
   *
   * Visibility is `protected` to match {@link addDomainEvent}; the publisher
   * (sibling shared-kernel module) crosses the protection boundary via a
   * package-internal `as` cast. If exposing to other packages, promote to
   * `public` AND restate the contract above.
   */
  protected restoreDomainEvents(events: DomainEvent[]): void {
    this.#domainEvents.push(...events)
  }
}
