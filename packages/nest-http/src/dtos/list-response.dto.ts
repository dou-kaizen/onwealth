import { ApiProperty } from '@nestjs/swagger'

/**
 * Base envelope for non-paginated collection responses.
 *
 * Shape `{ object: 'list', data: [...] }` matches the Google AIP-158 +
 * Stripe API convention so clients can branch on `object` to distinguish
 * collections from single resources without inspecting payload structure.
 *
 * @typeParam T — element type of the `data` array.
 */
export class ListResponseDto<T> {
  @ApiProperty({
    description: 'Object type identifier',
    example: 'list',
    enum: ['list'],
  })
  readonly object = 'list' as const

  @ApiProperty({
    description: 'Actual data array',
    isArray: true,
  })
  data: T[]
}

/**
 * Envelope for offset-paginated collection responses.
 *
 * Adds 1-based `page`, `pageSize`, `total`, and `hasMore` siblings to the
 * base list envelope. Flat layout (no nested `pagination` object) keeps
 * client code direct.
 *
 * @typeParam T — element type of the `data` array.
 */
export class OffsetListResponseDto<T> extends ListResponseDto<T> {
  @ApiProperty({
    description: 'Current page number (1-based)',
    example: 1,
  })
  page: number

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  pageSize: number

  @ApiProperty({
    description: 'Total number of items',
    example: 100,
  })
  total: number

  @ApiProperty({
    description: 'Whether there are more items',
    example: true,
  })
  hasMore: boolean
}

/**
 * Envelope for cursor-paginated collection responses.
 *
 * `nextCursor` is `null` on the final page so clients can stop fetching
 * without inspecting `hasMore`. Both fields are kept for parity with the
 * offset variant — `hasMore` is the boolean clients usually branch on.
 *
 * @typeParam T — element type of the `data` array.
 */
export class CursorListResponseDto<T> extends ListResponseDto<T> {
  @ApiProperty({
    type: String,
    description: 'Next page cursor token (Base64-encoded); null when no more data',
    example: 'eyJpZCI6InVzcl8wMjAifQ==',
    nullable: true,
  })
  nextCursor: string | null

  @ApiProperty({ description: 'Whether there are more items', example: true })
  hasMore: boolean
}
