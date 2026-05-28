/**
 * Return type contract for all queue job processors.
 *
 * `message` is a human-readable outcome summary (logged on success).
 * Additional domain-specific fields may be added via the index signature.
 */
export interface QueueJobResult {
  message: string
  [key: string]: unknown
}
