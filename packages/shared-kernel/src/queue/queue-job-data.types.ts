/**
 * Convention base shape for all BullMQ job payloads.
 *
 * Concrete payload types should extend this so {@link QueueProcessorBase} can
 * surface `correlationId` in its `onFailed` / `onCompleted` / `onStalled`
 * log contexts. Producers populate `correlationId` from CLS at enqueue time
 * so a downstream worker log line joins the originating HTTP request trace.
 *
 * @example
 *   interface SendEmailJobData extends QueueJobBaseData {
 *     toEmail: string
 *   }
 *
 *   await queue.add('send', {
 *     correlationId: cls.get('correlationId'),
 *     toEmail: 'user@example.com',
 *   } satisfies SendEmailJobData)
 */
export interface QueueJobBaseData {
  correlationId?: string
}
