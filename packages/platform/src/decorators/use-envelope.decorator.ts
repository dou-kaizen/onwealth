import { SetMetadata } from '@nestjs/common'

/**
 * `@UseEnvelope()` — opts an endpoint into wrapped responses.
 *
 * Design (Google API Design Guide / AIP-193):
 *   - single resources return naked
 *   - collections / paginated responses opt into the envelope
 *
 * The `TransformInterceptor` reads `USE_ENVELOPE_KEY` via `Reflector`.
 *
 * @example
 * ```ts
 * @Get()
 * @UseEnvelope()
 * async list() {
 *   return { object: 'list', data: [...], hasMore: true }
 * }
 * ```
 */
export const USE_ENVELOPE_KEY = 'use_envelope'

export const UseEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(USE_ENVELOPE_KEY, true)
