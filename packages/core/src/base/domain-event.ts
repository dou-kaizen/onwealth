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
 *   override readonly eventName = 'article.published'
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
   * Stable wire identifier for routing on the event bus.
   *
   * Declared abstract so subclasses MUST provide an explicit literal —
   * relying on `this.constructor.name` is unsafe under SWC/Terser, which
   * mangle class names by default and would silently break consumers
   * that key off the event name (subscriptions, routing, replay logs).
   * Use a dotted string like `'article.published'`.
   */
  abstract readonly eventName: string
}
