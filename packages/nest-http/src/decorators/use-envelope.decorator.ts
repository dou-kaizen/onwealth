import { SetMetadata } from '@nestjs/common'

/** Metadata key read by the envelope transform interceptor. */
export const USE_ENVELOPE_KEY = 'use_envelope'

/**
 * Mark a route handler as returning an envelope-wrapped payload.
 *
 * **When to apply:** collection responses, paginated payloads, or any
 * response that needs sibling metadata. Single-resource handlers return
 * the resource directly — no decorator.
 *
 * Convention follows the Google API Design Guide collection pattern
 * ({@link https://cloud.google.com/apis/design/design_patterns}): single
 * resources are returned bare; collections wrap in `{ object: 'list',
 * data: [...] }` so clients can attach metadata without breaking the
 * payload shape.
 *
 * @example
 * // Single resource — no decorator, returned directly
 * @Get(':id')
 * async getUser(@Param('id') id: string) {
 *   return { id, email: '...' }
 * }
 *
 * @example
 * // Collection — envelope required
 * @Get()
 * @UseEnvelope()
 * async getUsers() {
 *   return { object: 'list', data: [...], hasMore: true }
 * }
 */
export const UseEnvelope = () => SetMetadata(USE_ENVELOPE_KEY, true)
