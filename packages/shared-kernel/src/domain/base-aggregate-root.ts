import type { DomainEvent } from './events/domain-event.base.js'

export abstract class BaseAggregateRoot {
  #domainEvents: DomainEvent[] = []

  getDomainEvents(): DomainEvent[] {
    return [...this.#domainEvents]
  }

  protected addDomainEvent(event: DomainEvent): void {
    this.#domainEvents.push(event)
  }

  clearDomainEvents(): void {
    this.#domainEvents = []
  }

  /**
   * Re-attach previously-detached events to the aggregate. Used by
   * {@link DomainEventPublisher} to put back events whose publish loop was
   * aborted before they were emitted. NOT for general callers — emitting code
   * should call {@link addDomainEvent} via the domain method that produced the
   * event.
   *
   * Visibility is `protected` to match {@link addDomainEvent}, but the publisher
   * (sibling shared-kernel module) crosses the protection boundary via a
   * package-internal `as` cast. If you need to expose this to other packages,
   * promote to `public` here AND restate the contract above.
   */
  protected restoreDomainEvents(events: DomainEvent[]): void {
    this.#domainEvents.push(...events)
  }
}
