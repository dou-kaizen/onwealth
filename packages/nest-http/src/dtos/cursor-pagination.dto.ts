import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsOptional } from 'class-validator'

import {
  IsIntField,
  IsStringField,
  MaxField,
  MaxLengthField,
  MinField,
} from '../decorators/validators/index.js'

/**
 * Query DTO for cursor-based pagination (`?cursor=&pageSize=`).
 *
 * **Trade-offs vs offset pagination:**
 * - Query cost is constant regardless of position — typically ~0.025ms
 *   when the cursor's columns are indexed.
 * - Strong read-after-write consistency — concurrent inserts cannot
 *   shift the cursor's position, so pages never duplicate or miss rows.
 * - No direct page-number navigation — clients walk pages sequentially.
 *
 * **Use when:** dataset > 10,000 rows, real-time data, or strict
 * consistency is required.
 *
 * Cursor is opaque to clients (Base64-encoded JSON containing the
 * boundary key); `MaxLengthField(512)` prevents abusive cursor payloads.
 *
 * @see {@link https://docs.stripe.com/api/pagination} — Stripe API pagination
 * @see {@link https://relay.dev/graphql/connections.htm} — Relay Cursor Connections
 */
export class CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Number of items per page', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsIntField()
  @MinField(1)
  @MaxField(100)
  pageSize?: number = 20

  @ApiPropertyOptional({
    description: 'Cursor token (Base64-encoded JSON object)',
    example: 'eyJpZCI6InVzcl8wMjAifQ==',
  })
  @IsOptional()
  @IsStringField()
  @MaxLengthField(512)
  cursor?: string
}
