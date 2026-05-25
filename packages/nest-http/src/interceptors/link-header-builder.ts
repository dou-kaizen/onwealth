/**
 * Pure RFC 8288 link-header builders. Extracted from
 * {@link LinkHeaderInterceptor} so the link-composition rules can be
 * unit-tested without spinning up an `ExecutionContext`, and so the
 * interceptor file stays under the 200-line guideline.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288.html} — RFC 8288 (Web Linking)
 */

/** Minimum shape of an offset-paginated list response. */
export interface OffsetListResponse {
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/** Minimum shape of a cursor-paginated list response. */
export interface CursorListResponse {
  hasMore?: boolean
  nextCursor?: string
}

/**
 * Duck-type guard for the list-envelope shape
 * (`{ object: 'list', data: [...] }`).
 */
export function isListResponse(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'object' in data &&
    (data as Record<string, unknown>).object === 'list' &&
    'data' in data &&
    Array.isArray((data as Record<string, unknown>).data)
  )
}

/** Duck-type guard for the offset-paginated shape. */
export function isOffsetListResponse(data: unknown): data is OffsetListResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'total' in data &&
    'page' in data &&
    'pageSize' in data &&
    typeof (data as Record<string, unknown>).total === 'number'
  )
}

/**
 * Compose a query string from existing params with an override layer.
 *
 * Uses `append` (not `set`) for incoming params so multi-value query
 * strings like `?status=active&status=pending` survive into the
 * generated `next`/`prev` links. Overrides (pagination controls — always
 * single-value by contract) use `set`.
 *
 * Pagination cursor params (`cursor`, `page`) are filtered out of the
 * incoming side so they cannot leak past the overrides.
 *
 * @param baseUrl — already-resolved absolute URL for the current path.
 * @param query   — Express `request.query` shape.
 * @param overrides — fields to inject (e.g. `{ page: 2, pageSize: 20 }`).
 */
export function buildUrl(
  baseUrl: string,
  query: Record<string, unknown>,
  overrides: Record<string, string | number> = {},
): string {
  const parameters = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (key !== 'cursor' && key !== 'page') {
      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        parameters.append(key, String(v))
      }
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    parameters.set(key, String(value))
  }

  const queryString = parameters.toString()
  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

/**
 * Build the RFC 8288 `Link` header value as an array (caller joins with
 * `, `).
 *
 * **Cursor pagination:** emits `self` and (when `hasMore && nextCursor`)
 * `next`. `prev`/`first`/`last` are omitted — cursor walks are one-way.
 *
 * **Offset pagination:** emits `first` (when `page > 1`), `prev`, `self`,
 * `next` (when `hasMore`), and `last` (when not on the final page).
 *
 * @param baseUrl — already-resolved absolute URL for the current request
 *                  path. The caller composes this from
 *                  `httpConfig.apiBaseUrl` + `request.path` rather than
 *                  trusting `request.protocol` / `request.get('host')`,
 *                  which are attacker-influenced behind a reverse proxy.
 * @param query   — Express `request.query` object (multi-value supported).
 * @param data    — response body; duck-typed for cursor vs offset shape.
 */
export function buildLinks(
  baseUrl: string,
  query: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const links: string[] = []

  if ('nextCursor' in data) {
    if (
      'hasMore' in data &&
      data.hasMore &&
      data.nextCursor &&
      typeof data.nextCursor === 'string'
    ) {
      const nextUrl = buildUrl(baseUrl, query, { cursor: data.nextCursor })
      links.push(`<${nextUrl}>; rel="next"`)
    }
    const selfUrl = buildUrl(baseUrl, query)
    links.push(`<${selfUrl}>; rel="self"`)
    return links
  }

  if (isOffsetListResponse(data)) {
    const { page, pageSize, total, hasMore } = data
    const totalPages = Math.ceil(total / pageSize)
    const hasPrevious = page > 1

    if (page > 1) {
      links.push(`<${buildUrl(baseUrl, query, { page: 1, pageSize })}>; rel="first"`)
    }
    if (hasPrevious) {
      links.push(`<${buildUrl(baseUrl, query, { page: page - 1, pageSize })}>; rel="prev"`)
    }
    links.push(`<${buildUrl(baseUrl, query)}>; rel="self"`)
    if (hasMore) {
      links.push(`<${buildUrl(baseUrl, query, { page: page + 1, pageSize })}>; rel="next"`)
    }
    if (page < totalPages) {
      links.push(`<${buildUrl(baseUrl, query, { page: totalPages, pageSize })}>; rel="last"`)
    }
  }

  return links
}
