/**
 * Base class for in-context domain events.
 *
 * Subclass for significant business state changes that should be propagated
 * to other components WITHIN the same bounded context. Cross-context
 * communication uses {@link IntegrationEvent} instead.
 *
 * Every instance is stamped with:
 * - `occurredOn` — wall-clock timestamp at construction.
 * - `eventId` — `crypto.randomUUID()` for idempotency / dedup downstream.
 *
 * @example
 *   export class ArticlePublishedEvent extends DomainEvent {
 *     constructor(
 *       public readonly articleId: string,
 *       public readonly title: string,
 *     ) {
 *       super()
 *     }
 *   }
 */
export abstract class DomainEvent {
  public readonly occurredOn: Date

  public readonly eventId: string

  constructor() {
    this.occurredOn = new Date()
    this.eventId = crypto.randomUUID()
  }

  /**
   * Event name used for routing on the event bus.
   *
   * Defaults to the constructor name; subclasses may override to decouple
   * the wire name from the class identifier (e.g. to survive minification).
   */
  get eventName(): string {
    return this.constructor.name
  }
}
