/**
 * RFC 8288 Link header builder — pure functions, extracted from
 * `link-header.interceptor.ts` (M25) so the interceptor stays under the
 * 200-line guideline and the link-building rules can be unit-tested without
 * having to spin up an ExecutionContext.
 *
 * Spec: RFC 8288 (Web Linking)
 * https://www.rfc-editor.org/rfc/rfc8288.html
 */

export interface OffsetListResponse {
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface CursorListResponse {
  hasMore?: boolean
  nextCursor?: string
}

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
 * Compose a query string, preserving multi-value params and applying overrides.
 *
 * Uses `append` (not `set`) for incoming query params so
 * `?status=active&status=pending` survives into next/prev links. Overrides
 * (pagination controls — always single-value) use `set`.
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
 * Build the RFC 8288 Link header array from a paginated response.
 *
 * @param baseUrl  Already-resolved absolute URL for the current request path
 *                 (e.g. `https://api.example.com/api/users`). The caller is
 *                 responsible for composing this from `httpConfig.apiBaseUrl` +
 *                 `request.path` — see M6 for why we no longer trust
 *                 `request.protocol` / `request.get('host')` here.
 * @param query    Express `request.query` object (multi-value supported).
 * @param data     The response body — duck-typed for cursor or offset pagination.
 */
export function buildLinks(
  baseUrl: string,
  query: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const links: string[] = []

  // Cursor pagination
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

  // Offset pagination (flat format)
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
