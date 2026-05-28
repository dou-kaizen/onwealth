import { QueueException } from './queue.exception.js'

/**
 * Default maximum serialized payload size, in bytes (64 KiB).
 *
 * Tuned to keep Redis job-hash entries small enough that BullMQ checkpoints
 * stay snappy. Override per call when a queue has a justified larger budget
 * (e.g. document-processing payloads bounded by upstream upload limits).
 */
const DEFAULT_MAX_BYTES = 64 * 1024

/**
 * Producer-side guard: refuse to enqueue payloads exceeding `maxBytes` once
 * serialized to UTF-8.
 *
 * Use at the call site BEFORE `queue.add(name, payload)`. Large payloads
 * blow up Redis memory (BullMQ stores the full job hash) and slow worker
 * checkpoints. NOT enforced inside `QueueProcessorBase` because the producer
 * owns the schema; the worker only sees deserialized data.
 *
 * **Behavior:**
 * - Byte length is measured via `Buffer.byteLength(serialized, 'utf8')` so
 *   multi-byte characters (`'😀'`) are counted correctly. Using `.length`
 *   here would undercount by up to 4x.
 * - `JSON.stringify` is wrapped in `try/catch` so circular references raise
 *   a typed {@link QueueException} instead of leaking the raw `TypeError`.
 * - `JSON.stringify(undefined)` returns `undefined`; that path is treated
 *   as zero-byte and accepted. Producer-side schema validation is expected
 *   to reject nullish payloads earlier.
 *
 * **Prerequisite:** callers MUST Zod-validate `payload` first. Zod's
 * `.strict()` + `.max()` on nested objects defends against deep-nest DoS
 * that would otherwise block the event loop inside `JSON.stringify`.
 *
 * @param payload  Already-validated job payload.
 * @param maxBytes UTF-8 byte ceiling. Defaults to {@link DEFAULT_MAX_BYTES}.
 *
 * @throws {@link QueueException} on oversize or unserializable payload.
 *
 * @example
 *   const payload = sendEmailSchema.parse(input)
 *   assertPayloadSize(payload)
 *   await this.queue.add('send', payload)
 */
export function assertPayloadSize(payload: unknown, maxBytes: number = DEFAULT_MAX_BYTES): void {
  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch {
    throw new QueueException('payload not serializable')
  }
  if (serialized === undefined) return
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > maxBytes) {
    throw new QueueException(`payload exceeds ${maxBytes} bytes (got ${bytes})`)
  }
}
