import { Global, Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'

import { DomainEventPublisher } from './domain-event-publisher.js'

/**
 * Domain events module
 *
 * Provides DomainEventPublisher to all modules.
 *
 * Prerequisite: the consuming AppModule must call EventEmitterModule.forRoot()
 * once (with wildcard/delimiter/maxListeners options) — that call registers the
 * EventEmitter2 provider DomainEventPublisher depends on. The forRoot config
 * stays app-owned to avoid duplicate global registration.
 *
 * The bare `imports: [EventEmitterModule]` below documents the dependency but
 * does NOT register EventEmitter2 (a no-forRoot import has no providers).
 * Standalone use — e.g. a focused integration test importing only this module —
 * must therefore also import EventEmitterModule.forRoot() in its own test
 * module; importing DomainEventsModule alone will not resolve EventEmitter2.
 */
@Global() // @global-approved: 框架级事件总线，所有发布领域事件的 context 都依赖
@Module({
  imports: [EventEmitterModule],
  providers: [DomainEventPublisher],
  exports: [DomainEventPublisher],
})
export class DomainEventsModule {}
