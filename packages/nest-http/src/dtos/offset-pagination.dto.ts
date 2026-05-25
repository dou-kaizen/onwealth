import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsOptional } from 'class-validator'

import { IsIntField, MaxField, MinField } from '../decorators/validators/index.js'

/**
 * Query DTO for offset-based pagination (`?page=&pageSize=`).
 *
 * **Trade-offs vs cursor pagination:**
 * - Query cost grows with `page` — at `offset=100k` Postgres reads ~100k
 *   rows before discarding them (~30ms+).
 * - Concurrent inserts shift rows across page boundaries, causing
 *   duplicates or misses between paginated calls.
 * - Enables direct page-number navigation, which cursor pagination cannot.
 *
 * **Use when:** dataset < 1,000 rows OR UX needs numeric page jumps.
 * **Avoid when:** dataset > 10,000 rows OR write frequency is high — use
 * {@link import('./cursor-pagination.dto.js').CursorPaginationDto} instead.
 *
 * Hard caps: `page ≤ 10_000` prevents pathological offsets; `pageSize ≤ 100`
 * keeps per-request payloads bounded.
 */
export class OffsetPaginationDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsIntField()
  @MinField(1)
  @MaxField(10_000)
  page?: number = 1

  @ApiPropertyOptional({ description: 'Number of items per page', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsIntField()
  @MinField(1)
  @MaxField(100)
  pageSize?: number = 20
}
