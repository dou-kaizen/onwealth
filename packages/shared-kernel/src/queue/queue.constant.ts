/**
 * BullMQ connection key used by producer-side code (enqueue).
 * Registered in QueueModule as a named BullModule root connection.
 */
export const QueueConfigKey = 'queue'

/**
 * BullMQ connection key used by worker/processor-side code (consume).
 * Kept separate from QueueConfigKey to isolate blocking BRPOP connections
 * from non-blocking producer connections.
 */
export const QueueProcessorConfigKey = 'queue-processor'
