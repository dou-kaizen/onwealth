/**
 * BullMQ shared connection key registered by QueueModule.
 *
 * Used by both producer (`BullModule.registerQueue({ configKey: QueueConfigKey, name })`)
 * and worker (`@QueueProcessor(name)` — wires it via decorator metadata).
 *
 * NOTE: A previous split (`QueueConfigKey` / `QueueProcessorConfigKey`) was
 * collapsed because `@nestjs/bullmq`'s `BullExplorer.getQueueOptions` prefers
 * a registered Queue's `opts.connection` over the worker's `configKey` shared
 * config — so the split was silently defeated for any queue created via
 * `BullModule.registerQueue`. The unified key uses worker-safe ioredis
 * settings (`maxRetriesPerRequest: null`) so blocking BRPOP works; the
 * producer-side cost is that enqueues won't fail fast on a Redis outage.
 * Acceptable tradeoff for boilerplate; consumers needing producer fail-fast
 * can construct a separate `Queue` with their own ioredis instance.
 */
export const QueueConfigKey = 'queue'
