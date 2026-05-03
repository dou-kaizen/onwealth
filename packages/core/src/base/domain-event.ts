import { randomUUID } from 'crypto'

/**
 * Base class for domain events.
 *
 * Subclasses describe a meaningful business state change inside a single
 * bounded context. Use `IntegrationEvent` for cross-context messaging.
 *
 * @example
 * ```ts
 * export class ArticlePublishedEvent extends DomainEvent {
 *   constructor(
 *     public readonly articleId: string,
 *     public readonly title: string,
 *   ) {
 *     super()
 *   }
 * }
 * ```
 */
export abstract class DomainEvent {
  public readonly occurredOn: Date
  public readonly eventId: string

  constructor() {
    this.occurredOn = new Date()
    this.eventId = randomUUID()
  }

  /**
   * Event name used for routing on the event bus.
   * Defaults to the constructor name; subclasses may override.
   */
  get eventName(): string {
    return this.constructor.name
  }
}
