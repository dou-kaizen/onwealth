import { DomainEvent } from './domain-event.base.js'

/**
 * Base class for cross-context (inter-module) integration events.
 *
 * Unlike {@link DomainEvent}, integration events cross bounded-context
 * boundaries — consumers cannot query back into the publisher's aggregates,
 * so the event payload MUST be self-contained.
 *
 * Adds two fields on top of {@link DomainEvent}:
 * - `version` — for schema evolution; bump when the payload shape changes.
 * - `source` — name of the bounded context / module that published the event.
 *
 * @example
 *   export class UserRegisteredIntegrationEvent extends IntegrationEvent {
 *     constructor(
 *       public readonly userId: string,
 *       public readonly email: string,
 *       public readonly username: string,
 *     ) {
 *       super('identity')
 *     }
 *   }
 */
export abstract class IntegrationEvent extends DomainEvent {
  public readonly version: number = 1

  public readonly source: string

  constructor(source: string) {
    super()
    this.source = source
  }
}
