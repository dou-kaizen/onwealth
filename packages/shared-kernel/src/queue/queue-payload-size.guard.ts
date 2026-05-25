import { QueueException } from './queue.exception.js'

const DEFAULT_MAX_BYTES = 64 * 1024

/**
 * Producer-side guard: refuse to enqueue payloads exceeding `maxBytes` once
 * serialized to UTF-8.
 *
 * Use at the call site BEFORE `queue.add(name, payload)` — large payloads
 * blow up Redis memory (BullMQ stores the full job hash) and slow worker
 * checkpoints. NOT enforced inside `QueueProcessorBase` because the producer
 * owns the schema; the worker only sees deserialized data.
 *
 * Behavior:
 * - Measures byte length via `Buffer.byteLength(serialized, 'utf8')` so
 *   multi-byte characters (`'😀'`) are counted correctly. Using `.length`
 *   here would undercount by up to 4x.
 * - Wraps `JSON.stringify` in try/catch so circular references raise a typed
 *   `QueueException` instead of leaking the raw `TypeError`. Callers can
 *   then handle the failure uniformly with other queue exceptions.
 * - PREREQUISITE: callers MUST Zod-validate `payload` first. Zod's
 *   `.strict()` + `.max()` on nested objects defends against deep-nest DoS
 *   that would block the event loop here.
 *
 * @example
 *   const payload = sendEmailSchema.parse(input)
 *   assertPayloadSize(payload)
 *   await this.queue.add('send', payload)
 *
 * @throws {@link QueueException} on oversize or unserializable payload
 */
export function assertPayloadSize(payload: unknown, maxBytes: number = DEFAULT_MAX_BYTES): void {
  let serialized: string
  try {
    serialized = JSON.stringify(payload)
  } catch {
    throw new QueueException('payload not serializable')
  }
  // `JSON.stringify(undefined)` returns `undefined`. Treat that as zero-byte
  // and accept it — the producer-side schema validation should catch nullish
  // payloads before they reach here.
  if (serialized === undefined) return
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > maxBytes) {
    throw new QueueException(`payload exceeds ${maxBytes} bytes (got ${bytes})`)
  }
}
