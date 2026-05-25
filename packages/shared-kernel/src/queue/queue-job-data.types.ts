/**
 * Convention base shape for all BullMQ job payloads.
 *
 * Concrete payload types should extend this so the worker base class can
 * surface `correlationId` in `onFailed` / `onCompleted` / `onStalled` log
 * contexts. Producers populate `correlationId` from CLS at enqueue time:
 *
 * @example
 *   await queue.add('send', {
 *     correlationId: cls.get('correlationId'),
 *     toEmail: 'user@example.com',
 *   } satisfies SendEmailJobData)
 */
export interface QueueJobBaseData {
  correlationId?: string
}
