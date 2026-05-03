import { DomainEvent } from './domain-event'

/**
 * Base class for integration events.
 *
 * Carries enough payload that downstream contexts do not need to query
 * back into the publishing context.
 */
export abstract class IntegrationEvent extends DomainEvent {
  /** Schema version (for event evolution) */
  public readonly version: number = 1

  /** Bounded-context / module that published the event */
  public readonly source: string

  constructor(source: string) {
    super()
    this.source = source
  }
}
