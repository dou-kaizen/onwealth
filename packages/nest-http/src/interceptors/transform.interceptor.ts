import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable, InternalServerErrorException, StreamableFile } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { USE_ENVELOPE_KEY } from '../decorators/use-envelope.decorator.js'

type ListEnvelope<T = unknown> = { object: 'list'; data: T[] }

/**
 * Enforce the project's response-shape contract.
 *
 * **Decision matrix:**
 * | Handler returns | `@UseEnvelope()`? | Outcome                               |
 * |-----------------|-------------------|---------------------------------------|
 * | single resource | absent            | returned as-is                        |
 * | scalar          | absent            | returned as-is                        |
 * | `T[]`           | present           | wrapped → `{ object: 'list', data }`  |
 * | already-envelope| present           | returned as-is (no double-wrap)       |
 * | non-list        | present           | `InternalServerErrorException` — bug  |
 *
 * **Always pass-through (regardless of decorator):**
 * - `null` / `undefined` — lets Nest decide 204 vs default body.
 * - `StreamableFile`, `Buffer` — binary streams, downloads, SSE.
 *
 * Throwing on `@UseEnvelope()` + non-list is intentional: it surfaces
 * controller bugs at request time instead of silently shipping a
 * mis-shaped payload.
 *
 * @see {@link https://cloud.google.com/apis/design/design_patterns}
 *      — Google API Design Guide (collection envelope pattern)
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const useEnvelope = this.reflector.getAllAndOverride<boolean>(USE_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    return next.handle().pipe(
      map((data: unknown) => {
        if (data === null || data === undefined) return data
        if (data instanceof StreamableFile) return data
        if (Buffer.isBuffer(data)) return data

        if (!useEnvelope) return data

        if (this.isListEnvelope(data)) return data
        if (Array.isArray(data)) return { object: 'list', data } satisfies ListEnvelope

        throw new InternalServerErrorException(
          '@UseEnvelope() requires controller to return an array or a ListResponseDto instance',
        )
      }),
    )
  }

  /** Duck-type check for an already-shaped `{ object: 'list', data: [] }`. */
  private isListEnvelope(data: unknown): data is ListEnvelope {
    return (
      typeof data === 'object' &&
      data !== null &&
      'object' in data &&
      (data as { object: unknown }).object === 'list' &&
      'data' in data &&
      Array.isArray((data as { data: unknown }).data)
    )
  }
}
