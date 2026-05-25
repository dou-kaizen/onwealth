import { describe, expect, it } from 'vitest'
import { sanitizeRedisUrl } from '../sanitize-redis-url.js'

describe('sanitizeRedisUrl', () => {
  it('redacts password from rediss:// URL', () => {
    expect(sanitizeRedisUrl('rediss://user:hunter2@host:6379/0')).toBe(
      'rediss://user:***@host:6379/0',
    )
  })

  it('redacts password from redis:// URL', () => {
    expect(sanitizeRedisUrl('redis://default:secret@redis.local:6380')).toBe(
      'redis://default:***@redis.local:6380',
    )
  })

  it('preserves URL when no password is present', () => {
    // `redis:` is a non-special URL scheme; `URL.toString()` does NOT append a
    // trailing slash on the empty path (unlike http/https).
    expect(sanitizeRedisUrl('redis://localhost:6379')).toBe('redis://localhost:6379')
    expect(sanitizeRedisUrl('redis://localhost:6379/0')).toBe('redis://localhost:6379/0')
  })

  it('handles password containing @', () => {
    const encoded = encodeURIComponent('pa@ss')
    const result = sanitizeRedisUrl(`redis://user:${encoded}@host:6379`)
    expect(result).toContain(':***@host')
    expect(result).not.toContain('pa%40ss')
  })

  it('handles password containing :', () => {
    const encoded = encodeURIComponent('pa:ss')
    const result = sanitizeRedisUrl(`redis://user:${encoded}@host:6379`)
    expect(result).toContain(':***@host')
  })

  it('returns sentinel for missing scheme', () => {
    expect(sanitizeRedisUrl('localhost:6379')).toBe('<unparseable-redis-url>')
  })

  it('returns sentinel for empty string', () => {
    expect(sanitizeRedisUrl('')).toBe('<unparseable-redis-url>')
  })

  it('returns sentinel for non-string input', () => {
    expect(sanitizeRedisUrl(undefined)).toBe('<unparseable-redis-url>')
    expect(sanitizeRedisUrl(null)).toBe('<unparseable-redis-url>')
    expect(sanitizeRedisUrl(42)).toBe('<unparseable-redis-url>')
    expect(sanitizeRedisUrl({ url: 'redis://x' })).toBe('<unparseable-redis-url>')
  })
})
