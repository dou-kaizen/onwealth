import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Injectable, InternalServerErrorException, StreamableFile } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { USE_ENVELOPE_KEY } from '../decorators/use-envelope.decorator.js'

type ListEnvelope<T = unknown> = { object: 'list'; data: T[] }

/**
 * Response transform interceptor.
 *
 * Contract:
 * - No `@UseEnvelope()`        -> return resource as-is (single object / scalar).
 * - `@UseEnvelope()` + array   -> wrap as `{ object: 'list', data: [...] }`.
 * - `@UseEnvelope()` + already-shaped envelope (incl. paginated DTOs) -> pass-through.
 * - `@UseEnvelope()` + non-list -> throw InternalServerErrorException (contract violation).
 *
 * Always pass-through:
 * - null / undefined (lets NestJS choose 204 or default body)
 * - StreamableFile, Buffer (binary streams / file downloads / SSE)
 *
 * Reference: https://cloud.google.com/apis/design/design_patterns
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
