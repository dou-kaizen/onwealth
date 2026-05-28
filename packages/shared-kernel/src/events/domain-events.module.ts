import { Global, Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'

import { DomainEventPublisher } from './domain-event-publisher.js'

/**
 * Global domain-events module.
 *
 * Exposes {@link DomainEventPublisher} to every consuming context.
 *
 * **Prerequisite:** the consuming `AppModule` MUST call
 * `EventEmitterModule.forRoot()` once (with `wildcard` / `delimiter` /
 * `maxListeners` options). That call registers the `EventEmitter2` provider
 * `DomainEventPublisher` depends on. The `forRoot` config stays app-owned
 * to avoid duplicate global registration across packages.
 *
 * The bare `imports: [EventEmitterModule]` below documents the dependency
 * but does NOT register `EventEmitter2` (a no-`forRoot` import has no
 * providers). Standalone use — e.g. a focused integration test importing
 * only this module — must ALSO import `EventEmitterModule.forRoot()` in
 * its own test module; importing `DomainEventsModule` alone will not
 * resolve `EventEmitter2`.
 */
@Global() // @global-approved: framework-level bus, every publisher context depends on it.
@Module({
  imports: [EventEmitterModule],
  providers: [DomainEventPublisher],
  exports: [DomainEventPublisher],
})
export class DomainEventsModule {}
