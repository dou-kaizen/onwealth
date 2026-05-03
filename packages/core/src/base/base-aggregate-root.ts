import type { DomainEvent } from './domain-event'

/**
 * Aggregate root base. Tracks pending domain events; the application
 * layer is responsible for draining them via a publisher after persistence.
 */
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
}
